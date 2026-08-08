import { homedir } from "node:os";
import { join } from "node:path";
import { discoverClaudeCodeMcpServers, discoverClaudeCodePlugins } from "./claude-code.js";
import { discoverCodexMcpServers, discoverCodexPlugins } from "./codex.js";
import { discoverLooseSkills, skillToComponent } from "./skills.js";
import type { ClientId, Component, Inventory } from "../domain/types.js";

export interface DiscoveryWarning {
  readonly client: ClientId;
  readonly what: string;
  readonly reason: string;
}

export interface BuildInventoryResult {
  readonly inventory: Inventory;
  readonly warnings: readonly DiscoveryWarning[];
}

/**
 * Skills under `~/.claude/skills/` and `<cwd>/.claude/skills/` are shared: both Clients
 * discover them from the same paths (PLAN.md's cross-client skill sharing finding), so a
 * skill found on disk is reported against both, not duplicated as two Components.
 */
async function discoverSkillComponents(cwd: string, claudeHome: string): Promise<Component[]> {
  const roots = [join(claudeHome, "skills"), join(cwd, ".claude", "skills")];
  const byKey = new Map<string, Component>();
  for (const root of roots) {
    const skills = await discoverLooseSkills(root);
    for (const skill of skills) {
      const component = skillToComponent(skill, ["claude-code", "codex"]);
      byKey.set(component.id.key, component); // project root wins over global on name clash
    }
  }
  return [...byKey.values()];
}

export async function buildInventory(
  cwd: string = process.cwd(),
  // Override point for tests; production callers rely on the default (~/.claude).
  claudeHome: string = join(homedir(), ".claude"),
): Promise<BuildInventoryResult> {
  const warnings: DiscoveryWarning[] = [];
  const note = (client: ClientId, what: string, outcome: { available: boolean; reason?: string }) => {
    if (!outcome.available) warnings.push({ client, what, reason: outcome.reason ?? "unavailable" });
  };

  const [claudePlugins, claudeMcp, codexPlugins, codexMcp, skills] = await Promise.all([
    discoverClaudeCodePlugins(),
    discoverClaudeCodeMcpServers(cwd),
    discoverCodexPlugins(),
    discoverCodexMcpServers(),
    discoverSkillComponents(cwd, claudeHome),
  ]);

  note("claude-code", "plugins", claudePlugins);
  note("claude-code", "mcp-servers", claudeMcp);
  note("codex", "plugins", codexPlugins);
  note("codex", "mcp-servers", codexMcp);

  const discoveredAt: ClientId[] = [];
  if (claudePlugins.available || claudeMcp.available) discoveredAt.push("claude-code");
  if (codexPlugins.available || codexMcp.available) discoveredAt.push("codex");

  const components = [
    ...claudePlugins.components,
    ...claudeMcp.components,
    ...codexPlugins.components,
    ...codexMcp.components,
    ...skills,
  ];

  return {
    inventory: { components, discoveredAt },
    warnings,
  };
}

export const CLIENT_IDS: readonly ClientId[] = ["claude-code", "codex"];
