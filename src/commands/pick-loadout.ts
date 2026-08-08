import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInventory } from "../inventory/index.js";
import { loadLoadouts } from "../loadout/store.js";
import { resolveLoadout } from "../loadout/resolve.js";
import { isValidLoadoutName, writeNewLoadoutFile } from "../loadout/write.js";
import { projectClaudeCode } from "../projection/claude-code.js";
import { projectCodex } from "../projection/codex.js";
import type { Prompter } from "../tui/prompter.js";
import type { Baseline, Inventory, Loadout } from "../domain/types.js";

const ALL_OPTION = "__plugged_in_all__";
const NONE_OPTION = "__plugged_in_none__";
const CREATE_OPTION = "__plugged_in_create__";

export interface PickLoadoutResult {
  readonly loadoutName: string;
  readonly created: boolean;
  readonly path?: string;
}

/**
 * PLAN.md Phase 6: "TUI picker when no Loadout is named." Lists every known Loadout plus
 * the two built-in baselines, and offers to create a new one on the spot. Only the picking
 * (and, if chosen, the write to disk) happens here — launching the Client is the caller's
 * job (`run`), so this stays testable without spawning anything.
 */
export async function pickOrCreateLoadout(cwd: string, prompter: Prompter, claudeHome?: string): Promise<PickLoadoutResult> {
  const [{ inventory }, loadouts] = await Promise.all([buildInventory(cwd, claudeHome), loadLoadouts(cwd)]);
  const existingNames = [...loadouts.keys()].sort();

  const choice = await prompter.select("No --loadout given. Pick one:", [
    ...existingNames.map((n) => ({ value: n, label: describeExistingLoadout(loadouts.get(n)!, inventory, loadouts) })),
    { value: ALL_OPTION, label: "all — everything on (native default)" },
    { value: NONE_OPTION, label: "none — everything off" },
    { value: CREATE_OPTION, label: "Create a new Loadout..." },
  ]);

  if (choice === ALL_OPTION) return { loadoutName: "all", created: false };
  if (choice === NONE_OPTION) return { loadoutName: "none", created: false };
  if (choice !== CREATE_OPTION) return { loadoutName: choice, created: false };

  return createLoadoutInteractively(cwd, prompter, inventory, loadouts, existingNames);
}

/**
 * `${name} (${scope})`, plus a refusal count so a Loadout that would fail to launch is
 * visible in the menu itself instead of only after committing to it (`run` would otherwise
 * show the same refusal wall, but only once you've already picked). A Loadout whose own
 * config is broken (unknown baseline, allow/deny contradiction) is flagged rather than
 * thrown from here — a bad *other* Loadout shouldn't crash the picker for everything else.
 */
function describeExistingLoadout(loadout: Loadout, inventory: Inventory, loadoutsByName: ReadonlyMap<string, Loadout>): string {
  const base = `${loadout.name} (${loadout.scope})`;
  try {
    const resolution = resolveLoadout(loadout, inventory, loadoutsByName);
    const previewWorkDir = join(tmpdir(), "plugged-in", "preview", "claude-code");
    const refusalCount =
      projectClaudeCode({ client: "claude-code", inventory, loadout: resolution }, previewWorkDir).refusals.length +
      projectCodex({ client: "codex", inventory, loadout: resolution }).refusals.length;
    if (refusalCount === 0) return base;
    return `${base} — ⚠ ${refusalCount} refusal${refusalCount === 1 ? "" : "s"}, see \`explain\``;
  } catch (err) {
    return `${base} — ⚠ invalid config: ${(err as Error).message}`;
  }
}

async function promptForNewName(prompter: Prompter, existingNames: readonly string[]): Promise<string> {
  for (;;) {
    const name = await prompter.input("Name for the new Loadout");
    if (!isValidLoadoutName(name)) {
      prompter.note(`Invalid name: use letters, numbers, "-", "_", "." only, and not "all"/"none".`);
      continue;
    }
    if (existingNames.includes(name)) {
      prompter.note(`A Loadout named "${name}" already exists — pick another name.`);
      continue;
    }
    return name;
  }
}

async function createLoadoutInteractively(
  cwd: string,
  prompter: Prompter,
  inventory: Inventory,
  loadouts: ReadonlyMap<string, Loadout>,
  existingNames: readonly string[],
): Promise<PickLoadoutResult> {
  const name = await promptForNewName(prompter, existingNames);

  const scope = (await prompter.select("Scope", [
    { value: "project", label: "project — .plugged-in/loadouts/ (committed, shared with the team)" },
    { value: "global", label: "global — ~/.plugged-in/loadouts/ (just you, any project)" },
  ])) as "project" | "global";

  const baselineChoice = await prompter.select("Baseline", [
    { value: "all", label: "all — start with everything on, then deny what you don't want" },
    { value: "none", label: "none — start with everything off, then allow what you want" },
    ...existingNames.map((n) => ({ value: n, label: `${n} — inherit its resolved state` })),
  ]);
  const baseline: Baseline =
    baselineChoice === "all"
      ? { kind: "all" }
      : baselineChoice === "none"
        ? { kind: "none" }
        : { kind: "loadout", name: baselineChoice };

  // A draft Loadout with no allow/deny yet, purely to resolve the baseline's starting state
  // for the toggle list below — never written to disk.
  const draft: Loadout = { name, baseline, allow: [], deny: [], scope, definedAt: "<draft>" };
  const baselineResolution = resolveLoadout(draft, inventory, loadouts);

  const items = inventory.components.map((c) => ({
    key: c.id.key,
    label: `[${c.id.kind}] ${c.id.key}`,
    initiallyOn: baselineResolution.decisions.get(c.id.key) === true,
  }));

  const finalOn =
    items.length > 0
      ? await prompter.toggleList("Toggle Components (starting from the baseline's state):", items)
      : new Set<string>();

  const allow: string[] = [];
  const deny: string[] = [];
  for (const item of items) {
    const isOn = finalOn.has(item.key);
    if (isOn && !item.initiallyOn) allow.push(item.key);
    if (!isOn && item.initiallyOn) deny.push(item.key);
  }

  const path = await writeNewLoadoutFile({ name, scope, baseline, allow, deny }, cwd);
  prompter.note(`Wrote ${path}`);
  return { loadoutName: name, created: true, path };
}
