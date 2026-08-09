import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { componentsFromMcpServers, readMcpServersFromFile, type McpJsonFile } from "./mcp-json.js";
import { runClientCommand, tryParseJson } from "../util/exec.js";
import type { Component } from "../domain/types.js";
import type { DiscoveryOutcome } from "./codex.js";

interface ClaudePluginEntry {
  readonly pluginId?: string;
  readonly name?: string;
  readonly marketplaceName?: string;
  readonly marketplace?: string;
  readonly status?: string;
  readonly installed?: boolean;
  readonly enabled?: boolean;
  readonly path?: string;
  readonly source?: { readonly path?: string };
}

/**
 * `claude plugin list --json`. CONFIRMED: the empty case returns a flat array (`[]`, checked
 * live in this environment — see spikes/s1-enabled-plugins.sh), unlike Codex's
 * `{"installed": [...]}` wrapper. UNCONFIRMED: per-entry field names when the array is
 * non-empty — `claude plugin install` was blocked by the auto-mode permission classifier
 * when this adapter was written, so entry parsing below accepts both Codex's field names
 * (`pluginId`, `marketplaceName`, `source.path`) and the more obvious guesses (`name`,
 * `marketplace`, `path`) as a hedge. Verify against a real installed plugin before trusting
 * `explain` output for a non-empty plugin Inventory.
 */
export async function discoverClaudeCodePlugins(): Promise<DiscoveryOutcome> {
  const result = await runClientCommand("claude", ["plugin", "list", "--json"]);
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const parsed = tryParseJson(result.stdout);
  const entries: ClaudePluginEntry[] | undefined = Array.isArray(parsed)
    ? (parsed as ClaudePluginEntry[])
    : Array.isArray((parsed as { installed?: unknown })?.installed)
      ? ((parsed as { installed: ClaudePluginEntry[] }).installed)
      : undefined;
  if (!entries) {
    return { components: [], available: false, reason: "unexpected `claude plugin list --json` output shape" };
  }

  const components: Component[] = [];
  for (const raw of entries) {
    if (raw.status === "not installed" || raw.installed === false) continue;
    const key = raw.pluginId ?? raw.name;
    if (!key) continue;
    const marketplace = raw.marketplaceName ?? raw.marketplace ?? (key.includes("@") ? key.split("@", 2)[1] : undefined);
    const displayName = raw.name ?? (key.includes("@") ? key.split("@", 2)[0]! : key);
    const sourcePath = raw.source?.path ?? raw.path ?? key;
    components.push({
      id: { kind: "plugin", key },
      name: displayName,
      clients: ["claude-code"],
      sourcePath,
      ...(marketplace !== undefined ? { marketplace } : {}),
    });
  }
  return { components, available: true };
}

/**
 * MCP servers Claude Code will load for a project: the project's own `.mcp.json`, plus
 * whatever is registered per-project in `~/.claude.json` (`projects[cwd].mcpServers`, the
 * format `claude mcp add` writes to). Plugin-provided MCP servers are NOT covered here — no
 * mechanical listing exists for those (see spikes/s2-strict-mcp-config.md); they're a known
 * gap until that spike is run.
 */
export async function discoverClaudeCodeMcpServers(cwd: string): Promise<DiscoveryOutcome> {
  const fromProjectFile = await readMcpServersFromFile(join(cwd, ".mcp.json"), "claude-code");

  const globalConfigPath = join(homedir(), ".claude.json");
  let fromUserConfig: Component[] = [];
  if (existsSync(globalConfigPath)) {
    const contents = await readFile(globalConfigPath, "utf8").catch(() => undefined);
    const parsed = contents ? (tryParseJson(contents) as { projects?: Record<string, McpJsonFile> } | undefined) : undefined;
    fromUserConfig = componentsFromMcpServers(parsed?.projects?.[cwd]?.mcpServers, "claude-code", globalConfigPath);
  }

  const byKey = new Map<string, Component>();
  for (const c of [...fromProjectFile, ...fromUserConfig]) byKey.set(c.id.key, c);
  return { components: [...byKey.values()], available: true };
}
