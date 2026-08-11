import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { buildInventory } from "../inventory/index.js";
import { loadProfiles } from "../profile/store.js";
import { resolveProfile } from "../profile/resolve.js";
import { isValidProfileName, writeNewProfileFile } from "../profile/write.js";
import { projectAll, type ProjectionContext } from "../projection/index.js";
import type { Prompter } from "../tui/prompter.js";
import type { Baseline, Component, Inventory, Profile } from "../domain/types.js";

const ALL_OPTION = "__plugdin_all__";
const NONE_OPTION = "__plugdin_none__";
const CREATE_OPTION = "__plugdin_create__";

export interface PickProfileResult {
  readonly profileName: string;
  readonly created: boolean;
  readonly path?: string;
}

/**
 * PLAN.md Phase 6: "TUI picker when no Profile is named." Lists every known Profile plus
 * the two built-in baselines, and offers to create a new one on the spot. Only the picking
 * (and, if chosen, the write to disk) happens here — launching the Client is the caller's
 * job (`run`), so this stays testable without spawning anything.
 */
export async function pickOrCreateProfile(cwd: string, prompter: Prompter, claudeHome?: string): Promise<PickProfileResult> {
  const [{ inventory }, profiles] = await Promise.all([buildInventory(cwd, claudeHome), loadProfiles(cwd)]);
  const existingNames = [...profiles.keys()].sort();

  const choice = await prompter.select("No --profile given. Pick one:", [
    ...existingNames.map((n) => ({ value: n, label: describeExistingProfile(profiles.get(n)!, inventory, profiles) })),
    { value: ALL_OPTION, label: "all — everything on (native default)" },
    { value: NONE_OPTION, label: "none — everything off" },
    { value: CREATE_OPTION, label: "Create a new Profile..." },
  ]);

  if (choice === ALL_OPTION) return { profileName: "all", created: false };
  if (choice === NONE_OPTION) return { profileName: "none", created: false };
  if (choice !== CREATE_OPTION) return { profileName: choice, created: false };

  return createProfileInteractively(cwd, prompter, inventory, profiles, existingNames);
}

/**
 * `${name} (${scope})`, plus a refusal count so a Profile that would fail to launch is
 * visible in the menu itself instead of only after committing to it (`run` would otherwise
 * show the same refusal wall, but only once you've already picked). A Profile whose own
 * config is broken (unknown baseline, allow/deny contradiction) is flagged rather than
 * thrown from here — a bad *other* Profile shouldn't crash the picker for everything else.
 */
function describeExistingProfile(profile: Profile, inventory: Inventory, profilesByName: ReadonlyMap<string, Profile>): string {
  const base = `${profile.name} (${profile.scope})`;
  try {
    const resolution = resolveProfile(profile, inventory, profilesByName);
    // Only refusal counts are wanted here, and no Client's refusals depend on the contents
    // of a config this preview would have to read off disk — so the Grok base config is left
    // empty rather than making the whole picker async to fetch something unused.
    const context: ProjectionContext = {
      workDir: join(tmpdir(), "plugdin", "preview"),
      grokHome: join(homedir(), ".grok"),
      grokBaseConfigToml: "",
      grokSkillRoots: [],
    };
    const refusalCount = Object.values(projectAll(inventory, resolution, context)).reduce(
      (total, projection) => total + projection.refusals.length,
      0,
    );
    if (refusalCount === 0) return base;
    return `${base} — ⚠ ${refusalCount} refusal${refusalCount === 1 ? "" : "s"}, see \`explain\``;
  } catch (err) {
    return `${base} — ⚠ invalid config: ${(err as Error).message}`;
  }
}

/**
 * A short heads-up shown inline in the toggle list, when known statically from the
 * Component itself — no need to simulate Projection per item. A Profile is shared across
 * every Client, so none of these ever hide or lock the toggle: a Component that's
 * problematic for one Client can still be freely toggled for the others with the same
 * Profile, so the choice stays fully in the user's hands — this only informs it. A Component
 * several Clients see can carry several caveats at once, so they are joined rather than
 * having the first one win.
 */
function componentCaveat(component: Component): string | undefined {
  const caveats: string[] = [];
  const on = (client: Component["clients"][number]) => component.clients.includes(client);

  // OpenCode's skill caveat — off denies the skill rather than hiding it — is deliberately
  // not here: it applies to every skill without exception, and repeating it down a list of
  // fifty rows would drown out the caveats that actually distinguish one row from another.
  // `explain` states it once, per Client, in its Projection notes.
  if (component.id.kind === "skill" && component.annotation === "unannotated" && on("claude-code")) {
    caveats.push("Claude Code: off needs `adopt` first");
  }
  if (component.id.kind === "plugin" && on("opencode")) {
    caveats.push("OpenCode: only turns off if every OpenCode plugin is off");
  }
  if (component.id.kind === "mcp-server") {
    if (on("codex")) caveats.push("Codex: can't be turned off, stays on regardless");
    if (on("pi")) caveats.push("Pi: can't be turned off, stays on regardless");
    if (!component.mcp && on("claude-code")) caveats.push("Claude Code: can't be turned on, no launch spec captured");
  }
  return caveats.length > 0 ? caveats.join("; ") : undefined;
}

async function promptForNewName(prompter: Prompter, existingNames: readonly string[]): Promise<string> {
  for (;;) {
    const name = await prompter.input("Name for the new Profile");
    if (!isValidProfileName(name)) {
      prompter.note(`Invalid name: use letters, numbers, "-", "_", "." only, and not "all"/"none".`);
      continue;
    }
    if (existingNames.includes(name)) {
      prompter.note(`A Profile named "${name}" already exists — pick another name.`);
      continue;
    }
    return name;
  }
}

async function createProfileInteractively(
  cwd: string,
  prompter: Prompter,
  inventory: Inventory,
  profiles: ReadonlyMap<string, Profile>,
  existingNames: readonly string[],
): Promise<PickProfileResult> {
  const name = await promptForNewName(prompter, existingNames);

  const scope = (await prompter.select("Scope", [
    { value: "project", label: "project — .plugdin/profiles/ (committed, shared with the team)" },
    { value: "global", label: "global — ~/.plugdin/profiles/ (just you, any project)" },
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
        : { kind: "profile", name: baselineChoice };

  // A draft Profile with no allow/deny yet, purely to resolve the baseline's starting state
  // for the toggle list below — never written to disk.
  const draft: Profile = { name, baseline, allow: [], deny: [], scope, definedAt: "<draft>" };
  const baselineResolution = resolveProfile(draft, inventory, profiles);

  const items = inventory.components.map((c) => {
    const caveat = componentCaveat(c);
    return {
      key: c.id.key,
      label: caveat ? `[${c.id.kind}] ${c.id.key} — ⚠ ${caveat}` : `[${c.id.kind}] ${c.id.key}`,
      initiallyOn: baselineResolution.decisions.get(c.id.key) === true,
    };
  });

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

  const path = await writeNewProfileFile({ name, scope, baseline, allow, deny }, cwd);
  prompter.note(`Wrote ${path}`);
  return { profileName: name, created: true, path };
}
