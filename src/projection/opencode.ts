import type { Activation, Projection, Refusal } from "../domain/types.js";

interface OpenCodeConfig {
  $schema: string;
  mcp?: Record<string, { enabled: boolean }>;
  plugin?: string[];
  permission?: { skill: Record<string, "allow" | "deny"> };
}

/**
 * OpenCode Projection: one inline config layer through `OPENCODE_CONFIG_CONTENT`
 * (ADR-0005). OpenCode loads that env var last, as a final local-scope merge over the
 * global, project, and managed layers — so it is the highest-priority config surface, needs
 * no files on disk, and leaves the user's `opencode.json` untouched. All three mechanisms
 * below were verified live 2026-08-09 against opencode 1.18.15 via `opencode debug config`,
 * `opencode debug agent build`, and `opencode mcp list`.
 *
 * MCP servers: `mcp.<name>.enabled = false`, which OpenCode's own docs describe as the way
 * to "disable a server inherited from a parent config" — a partial entry merges onto the
 * inherited one, so no lossy re-emission of the launch spec is needed (unlike Codex).
 * Servers staying on need no entry.
 *
 * Plugins: the `plugin` array is order-sensitive in a way worth being exact about. An empty
 * array REPLACES the inherited list (verified: base `["a","b"]` + `[]` resolves to `[]`),
 * but a non-empty array UNIONS with it (base `["a","b"]` + `["a"]` resolves to
 * `["b","a"]`) — OpenCode accumulates plugin origins across layers whenever a layer names
 * any. So turning *every* plugin off projects exactly; turning off *some* is unreachable
 * through config, and `--pure` is no substitute because it would also drop the plugins meant
 * to stay on, plus any auto-discovered `.opencode/plugin/*.ts` this tool never inventoried.
 * That gap has no fix through this tool, so it warns rather than refuses (ADR-0004).
 *
 * Skills: OpenCode has no per-skill discovery filter — `skills.paths` only adds. What it
 * does have is a `skill` permission key accepting per-name rules, verified to resolve into
 * the agent's ruleset. A denied skill therefore cannot run, but stays listed in the model's
 * catalog; that difference is reported as a Projection note, not silently.
 */
export function projectOpenCode(activation: Activation): Projection {
  const { inventory, loadout } = activation;
  const decisions = loadout.decisions;
  const warnings: Refusal[] = [];
  const notes: string[] = [];

  const mcp: Record<string, { enabled: boolean }> = {};
  const deniedSkillNames: string[] = [];
  const plugins: { on: string[]; off: Refusal[] } = { on: [], off: [] };

  for (const component of inventory.components) {
    if (!component.clients.includes("opencode")) continue;
    const decision = decisions.get(component.id.key) ?? false;

    if (component.id.kind === "mcp-server") {
      if (!decision) mcp[component.name] = { enabled: false };
      continue;
    }

    if (component.id.kind === "plugin") {
      if (decision) plugins.on.push(component.name);
      else {
        plugins.off.push({
          component: component.id,
          reason:
            "OpenCode's `plugin` array unions across config layers unless it is emptied outright, so a single plugin cannot be removed while others stay — left as OpenCode's own config already has it",
        });
      }
      continue;
    }

    if (component.id.kind === "skill" && !decision) {
      deniedSkillNames.push(component.name);
    }
  }

  const config: OpenCodeConfig = { $schema: "https://opencode.ai/config.json" };
  if (Object.keys(mcp).length > 0) config.mcp = mcp;

  // Only the all-off case is expressible; anything else leaves the inherited list alone.
  if (plugins.off.length > 0 && plugins.on.length === 0) config.plugin = [];
  else warnings.push(...plugins.off);

  if (deniedSkillNames.length > 0) {
    // Insertion order is the evaluation order and the LAST matching rule wins, so the broad
    // allow has to come first or it would re-allow every skill denied after it.
    const skill: Record<string, "allow" | "deny"> = { "*": "allow" };
    for (const name of deniedSkillNames) skill[name] = "deny";
    config.permission = { skill };
    notes.push(
      `${deniedSkillNames.length} skill(s) are turned off through OpenCode's \`skill\` permission (${deniedSkillNames.join(", ")}): they cannot run, but remain listed in the model's skill catalog — OpenCode has no per-skill discovery filter.`,
    );
  }

  return {
    client: "opencode",
    args: [],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    generatedFiles: [],
    mirrors: [],
    refusals: [],
    warnings,
    notes,
  };
}
