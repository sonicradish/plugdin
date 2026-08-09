import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { discoverClaudeCodeMcpServers, discoverClaudeCodePlugins } from "./claude-code.js";
import { discoverCodexMcpServers, discoverCodexPlugins } from "./codex.js";
import { discoverGrokComponents, discoverGrokMcpServers } from "./grok.js";
import { discoverOpenCode } from "./opencode.js";
import { discoverPiMcpServers, discoverPiPackages, discoverPiSkills } from "./pi.js";
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
 * Skills under `~/.claude/skills/` and `<cwd>/.claude/skills/` are shared: Claude Code,
 * Codex, Grok, and OpenCode all discover them from the same paths (PLAN.md's cross-client
 * skill sharing finding, extended to the two new Clients by their own docs and confirmed by
 * `grok inspect --json` and `opencode debug skill` both reporting these files). A skill
 * found on disk is therefore reported against those Clients, not duplicated per Client.
 *
 * Pi is deliberately absent: its loader never scans `~/.claude/skills/`.
 */
const SHARED_SKILL_CLIENTS: readonly ClientId[] = ["claude-code", "codex", "grok", "opencode"];

async function discoverSkillComponents(cwd: string, claudeHome: string): Promise<Component[]> {
  const roots = [join(claudeHome, "skills"), join(cwd, ".claude", "skills")];
  const byKey = new Map<string, Component>();
  for (const root of roots) {
    const skills = await discoverLooseSkills(root);
    for (const skill of skills) {
      const component = skillToComponent(skill, SHARED_SKILL_CLIENTS);
      byKey.set(component.id.key, component); // project root wins over global on name clash
    }
  }
  return [...byKey.values()];
}

/**
 * Two Clients reporting the same skill are reporting one Component, not two. They rarely
 * agree on how to spell it, though: the shared roots are a symlink farm, so Claude Code
 * names a skill by the `~/.claude/skills/` path it was found under while Grok reports the
 * `~/.agents/skills/` file that symlink resolves to. Matching on the resolved real path is
 * what makes "turn tdd off" mean the same thing everywhere, and matching on *only* the real
 * path is what keeps Pi's separately-installed `tdd` — a different file that happens to
 * share a name — from being silently folded in with it.
 *
 * The first Client to report a Component owns its key and fields; later ones contribute
 * their `clients` entry and, where it differs, their own path for it.
 */
async function reconcile(components: readonly Component[]): Promise<Component[]> {
  const identities = await Promise.all(
    components.map(async (component) => {
      if (component.id.kind !== "skill") return `${component.id.kind}:${component.id.key}`;
      // A skill with no real path behind it — OpenCode's built-ins report `<built-in>` — is
      // its own Component, identified by key. Falling back to the unresolvable path instead
      // would collapse every built-in into a single identity.
      const real = await realpath(component.sourcePath).catch(() => undefined);
      return real === undefined ? `skill-key:${component.id.key}` : `skill:${real}`;
    }),
  );

  const merged = new Map<string, Component>();
  identities.forEach((identity, index) => {
    const component = components[index]!;
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, component);
      return;
    }
    const clients = [...new Set([...existing.clients, ...component.clients])];
    const clientPaths: Record<string, readonly string[]> = { ...existing.clientPaths };
    for (const [client, paths] of Object.entries(component.clientPaths ?? {})) {
      clientPaths[client] = [...new Set([...(clientPaths[client] ?? []), ...paths])];
    }
    merged.set(identity, {
      ...existing,
      clients,
      ...(Object.keys(clientPaths).length > 0 ? { clientPaths } : {}),
      // A later Client may know a launch spec or description the first one couldn't see.
      ...(existing.mcp === undefined && component.mcp !== undefined ? { mcp: component.mcp } : {}),
      ...(existing.description === undefined && component.description !== undefined
        ? { description: component.description }
        : {}),
    });
  });
  return [...merged.values()];
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

  const [claudePlugins, claudeMcp, codexPlugins, codexMcp, grok, grokMcp, opencode, piPackages, skills, piSkills, piMcp] =
    await Promise.all([
      discoverClaudeCodePlugins(),
      discoverClaudeCodeMcpServers(cwd),
      discoverCodexPlugins(),
      discoverCodexMcpServers(),
      discoverGrokComponents(),
      discoverGrokMcpServers(),
      discoverOpenCode(),
      discoverPiPackages(cwd),
      discoverSkillComponents(cwd, claudeHome),
      discoverPiSkills(cwd),
      discoverPiMcpServers(cwd),
    ]);

  note("claude-code", "plugins", claudePlugins);
  note("claude-code", "mcp-servers", claudeMcp);
  note("codex", "plugins", codexPlugins);
  note("codex", "mcp-servers", codexMcp);
  note("grok", "skills-and-plugins", grok);
  note("grok", "mcp-servers", grokMcp);
  note("opencode", "skills", opencode.skills);
  note("opencode", "config", opencode.config);
  note("pi", "packages", piPackages);

  const discoveredAt: ClientId[] = [];
  if (claudePlugins.available || claudeMcp.available) discoveredAt.push("claude-code");
  if (codexPlugins.available || codexMcp.available) discoveredAt.push("codex");
  if (grok.available || grokMcp.available) discoveredAt.push("grok");
  if (opencode.skills.available || opencode.config.available) discoveredAt.push("opencode");
  if (piPackages.available) discoveredAt.push("pi");

  // Order matters: the shared loose skills come first so they own the `<name>@skills-dir`
  // key, and a per-Client report of the same file merges into that rather than the reverse.
  const components = await reconcile([
    ...skills,
    ...claudePlugins.components,
    ...claudeMcp.components,
    ...codexPlugins.components,
    ...codexMcp.components,
    ...grok.components,
    ...grokMcp.components,
    ...opencode.skills.components,
    ...opencode.config.components,
    ...piPackages.components,
    ...piSkills,
    ...piMcp,
  ]);

  return {
    inventory: { components, discoveredAt },
    warnings,
  };
}
