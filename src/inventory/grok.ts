import { dirname } from "node:path";
import { runClientCommand, runClientCommandToFile, tryParseJson } from "../util/exec.js";
import { mcpServerFingerprint } from "../util/fingerprint.js";
import type { Component } from "../domain/types.js";
import type { DiscoveryOutcome } from "./codex.js";

interface GrokInspectSkill {
  readonly name: string;
  readonly description?: string;
  readonly source?: { readonly type?: string; readonly path?: string };
}

interface GrokInspectPlugin {
  readonly id?: string;
  readonly pluginId?: string;
  readonly name?: string;
  readonly marketplace?: string;
  readonly marketplaceName?: string;
  readonly enabled?: boolean;
  readonly path?: string;
  readonly source?: { readonly path?: string };
}

interface GrokInspectJson {
  readonly skills?: readonly GrokInspectSkill[];
  readonly plugins?: readonly GrokInspectPlugin[];
}

/**
 * `grok inspect --json` — "Show the configuration Grok discovers for this directory".
 * Confirmed shape, run live in this environment 2026-08-09: a single object carrying
 * `skills`, `plugins`, `mcpServers`, `agents`, `hooks`, `permissions`, and `configSources`.
 * One read-only call answers what would otherwise take three, and it reports what Grok
 * *resolved* rather than what any one config file says — which matters because Grok layers
 * `~/.grok/config.toml` under `<repo-root>/.grok/` under `<cwd>/.grok/`.
 *
 * Skills come back as `{name, description, source: {type, path}}` where `type` is `user`
 * (either `~/.grok/skills/` or the shared `~/.claude/skills/`, already symlink-resolved) or
 * `bundled` (shipped inside Grok's own config home). `path` points at the SKILL.md; the
 * directory above it is what `[skills] ignore` matches, and what the shared skill roots key
 * on, so that is what is recorded here.
 */
export async function discoverGrokComponents(): Promise<DiscoveryOutcome> {
  const result = await runClientCommandToFile("grok", ["inspect", "--json"]);
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const parsed = tryParseJson(result.stdout) as GrokInspectJson | undefined;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.skills)) {
    return { components: [], available: false, reason: "unexpected `grok inspect --json` output shape" };
  }

  const components: Component[] = [];

  for (const raw of parsed.skills) {
    const skillMdPath = raw.source?.path;
    if (!raw.name || !skillMdPath) continue;
    const dir = dirname(skillMdPath);
    components.push({
      id: { kind: "skill", key: `${raw.name}@grok-skills` },
      name: raw.name,
      clients: ["grok"],
      sourcePath: dir,
      clientPaths: { grok: [dir] },
      // Grok's bundled skills ship with the client and are not on disk as loose skills, so
      // Claude Code's Annotation question never applies to them.
      annotation: "not-applicable",
      ...(raw.description !== undefined ? { description: raw.description } : {}),
    });
  }

  // UNVERIFIED shape: no plugin is installed in this environment, so `grok plugin list
  // --json` and `inspect`'s `plugins` both return `[]` and there is nothing to key off.
  // Field names below are hedged the same way the Claude Code adapter hedges its own
  // unverified plugin shape (see spikes/FINDINGS.md, S1).
  for (const raw of parsed.plugins ?? []) {
    const key = raw.id ?? raw.pluginId ?? raw.name;
    if (!key) continue;
    const marketplace = raw.marketplace ?? raw.marketplaceName;
    components.push({
      id: { kind: "plugin", key },
      name: raw.name ?? key,
      clients: ["grok"],
      sourcePath: raw.source?.path ?? raw.path ?? key,
      ...(marketplace !== undefined ? { marketplace } : {}),
    });
  }

  return { components, available: true };
}

interface GrokMcpEntry {
  readonly name?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  readonly scope?: string;
}

/**
 * `grok mcp list --json` — confirmed shape, run live 2026-08-09 against a server added for
 * the probe: a flat array of `{name, command, args, env, enabled, scope}`. `inspect` also
 * lists MCP servers but only as `{name, transport, target}`, dropping args and env, so this
 * is the call that can round-trip a launch spec.
 *
 * Servers already disabled in Grok's own config are still reported (with `enabled: false`);
 * they stay in the Inventory so a Loadout can turn them back *on*, which is a decision this
 * tool's Projection can express.
 */
export async function discoverGrokMcpServers(): Promise<DiscoveryOutcome> {
  const result = await runClientCommand("grok", ["mcp", "list", "--json"]);
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const parsed = tryParseJson(result.stdout);
  if (!Array.isArray(parsed)) {
    return { components: [], available: false, reason: "unexpected `grok mcp list --json` output shape" };
  }

  const components: Component[] = [];
  for (const raw of parsed as GrokMcpEntry[]) {
    if (!raw.command || !raw.name) continue;
    const args = raw.args ?? [];
    components.push({
      id: { kind: "mcp-server", key: mcpServerFingerprint(raw.command, args) },
      name: raw.name,
      clients: ["grok"],
      sourcePath: raw.command,
      mcp: { command: raw.command, args, env: raw.env ?? {} },
    });
  }
  return { components, available: true };
}
