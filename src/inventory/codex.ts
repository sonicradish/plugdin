import { runClientCommand, tryParseJson } from "../util/exec.js";
import { mcpServerFingerprint } from "../util/fingerprint.js";
import type { Component } from "../domain/types.js";

export interface DiscoveryOutcome {
  readonly components: readonly Component[];
  readonly available: boolean;
  readonly reason?: string;
}

interface CodexInstalledPluginEntry {
  readonly pluginId: string;
  readonly name: string;
  readonly marketplaceName: string;
  readonly installed?: boolean;
  readonly enabled?: boolean;
  readonly source?: { readonly path?: string };
}

interface CodexPluginListJson {
  readonly installed?: readonly CodexInstalledPluginEntry[];
}

/**
 * `codex plugin list --json` — confirmed shape, run live in this environment 2026-08-08:
 * `{ "installed": [{ pluginId: "documents@openai-primary-runtime", name, marketplaceName,
 * installed, enabled, source: { path } }, ...] }`. `pluginId` is already the canonical
 * `name@marketplace` key both Clients share (PLAN.md's "Verified foundations").
 */
export async function discoverCodexPlugins(): Promise<DiscoveryOutcome> {
  const result = await runClientCommand("codex", ["plugin", "list", "--json"]);
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const parsed = tryParseJson(result.stdout) as CodexPluginListJson | undefined;
  if (!parsed || !Array.isArray(parsed.installed)) {
    return { components: [], available: false, reason: "unexpected `codex plugin list --json` output shape" };
  }

  const components: Component[] = parsed.installed
    .filter((raw) => raw.installed !== false)
    .map((raw) => ({
      id: { kind: "plugin" as const, key: raw.pluginId },
      name: raw.name,
      clients: ["codex" as const],
      sourcePath: raw.source?.path ?? raw.pluginId,
      marketplace: raw.marketplaceName,
    }));
  return { components, available: true };
}

interface CodexMcpServerEntry {
  readonly name: string;
  readonly enabled?: boolean;
  readonly transport?: {
    readonly type?: string;
    readonly command?: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
  };
}

/** `codex mcp list --json` — confirmed shape, run live in this environment 2026-08-08. */
export async function discoverCodexMcpServers(): Promise<DiscoveryOutcome> {
  const result = await runClientCommand("codex", ["mcp", "list", "--json"]);
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const parsed = tryParseJson(result.stdout);
  if (!Array.isArray(parsed)) {
    return { components: [], available: false, reason: "unexpected `codex mcp list --json` output shape" };
  }

  const components: Component[] = [];
  for (const raw of parsed as CodexMcpServerEntry[]) {
    const command = raw.transport?.command;
    if (!command) continue;
    const args = raw.transport?.args ?? [];
    const key = mcpServerFingerprint(command, args);
    components.push({
      id: { kind: "mcp-server", key },
      name: raw.name,
      clients: ["codex"],
      sourcePath: command,
      mcp: { command, args, env: raw.transport?.env ?? {} },
    });
  }
  return { components, available: true };
}
