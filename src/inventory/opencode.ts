import { dirname } from "node:path";
import { runClientCommandToFile, tryParseJson } from "../util/exec.js";
import { mcpServerFingerprint } from "../util/fingerprint.js";
import type { Component } from "../domain/types.js";
import type { DiscoveryOutcome } from "./codex.js";

/**
 * OpenCode's two introspection calls, run one after the other rather than concurrently.
 * Each `opencode debug ...` invocation boots a full OpenCode instance and opens its SQLite
 * database; two at once lose the race with "database is locked" (seen live 2026-08-09 the
 * moment `buildInventory` started running every Client's discovery in parallel). Every other
 * Client here tolerates concurrent introspection, so only OpenCode's pair is serialized.
 */
export async function discoverOpenCode(): Promise<{ skills: DiscoveryOutcome; config: DiscoveryOutcome }> {
  const skills = await discoverOpenCodeSkills();
  const config = await discoverOpenCodeConfig();
  return { skills, config };
}

interface OpenCodeSkillEntry {
  readonly name?: string;
  readonly description?: string;
  /** An absolute path to the SKILL.md, or the literal `<built-in>`. */
  readonly location?: string;
}

const BUILT_IN_LOCATION = "<built-in>";

/**
 * `opencode debug skill` — confirmed shape, run live against opencode 1.18.15 on
 * 2026-08-09: a JSON array of `{name, description, location, content}`. `location` is either
 * an absolute SKILL.md path or the literal `<built-in>` for skills compiled into OpenCode
 * itself. OpenCode auto-loads external skills from `~/.claude/skills/` and `~/.agents/skills/`
 * as well as its own `.opencode/skill(s)/`, so most entries here are the same files the
 * other Clients see — `buildInventory` reconciles them by real path rather than by name.
 *
 * `content` is deliberately dropped: it is the skill's entire body, which for the built-in
 * config skill alone runs to several thousand words, and nothing downstream reads it.
 */
export async function discoverOpenCodeSkills(): Promise<DiscoveryOutcome> {
  const result = await runClientCommandToFile("opencode", ["debug", "skill"]);
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const parsed = tryParseJson(result.stdout);
  if (!Array.isArray(parsed)) {
    return { components: [], available: false, reason: "unexpected `opencode debug skill` output shape" };
  }

  const components: Component[] = [];
  for (const raw of parsed as OpenCodeSkillEntry[]) {
    if (!raw.name) continue;
    const builtIn = !raw.location || raw.location === BUILT_IN_LOCATION;
    const dir = builtIn ? BUILT_IN_LOCATION : dirname(raw.location!);
    components.push({
      id: { kind: "skill", key: `${raw.name}@opencode-skills` },
      name: raw.name,
      clients: ["opencode"],
      sourcePath: dir,
      // Annotation is a Claude Code shim (ADR-0003), and nothing reported here is a Claude
      // Code skill: a skill under a root Claude Code shares gets reconciled into that shared
      // Component, which carries the real Annotation state. What is left is OpenCode's own
      // (`.opencode/skill(s)/`, built-ins, `~/.agents/skills/` entries Claude Code has no
      // symlink to) — where `adopt` would change nothing, so it must not be advertised.
      annotation: "not-applicable",
      ...(raw.description !== undefined ? { description: raw.description } : {}),
    });
  }
  return { components, available: true };
}

interface OpenCodeMcpEntry {
  readonly type?: string;
  readonly command?: readonly string[];
  readonly url?: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
}

interface OpenCodeConfigJson {
  readonly mcp?: Readonly<Record<string, OpenCodeMcpEntry>>;
  readonly plugin?: readonly (string | readonly unknown[])[];
}

/**
 * `opencode debug config` — "show resolved configuration", i.e. the merged result of the
 * global, project, managed, and env-var layers, which is exactly what a Profile has to
 * reason about. Confirmed shape 2026-08-09: `{$schema, agent, mode, plugin, command,
 * username, mcp?}` where `mcp` is keyed by server name and each entry is discriminated by
 * `type` — `local` carries `command: string[]` (argv as one array, not command-plus-args)
 * and `environment`; `remote` carries `url` and `headers`.
 *
 * A remote server has no launch command to fingerprint, so its URL stands in as the
 * fingerprint input. That keeps one identity scheme for MCP servers across every Client
 * rather than special-casing transport.
 */
export async function discoverOpenCodeConfig(): Promise<DiscoveryOutcome> {
  const result = await runClientCommandToFile("opencode", ["debug", "config"]);
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const parsed = tryParseJson(result.stdout) as OpenCodeConfigJson | undefined;
  if (!parsed || typeof parsed !== "object") {
    return { components: [], available: false, reason: "unexpected `opencode debug config` output shape" };
  }

  const components: Component[] = [];

  for (const [name, spec] of Object.entries(parsed.mcp ?? {})) {
    const argv = spec.command ?? [];
    const command = spec.type === "remote" ? spec.url : argv[0];
    if (!command) continue;
    const args = spec.type === "remote" ? [] : argv.slice(1);
    components.push({
      id: { kind: "mcp-server", key: mcpServerFingerprint(command, args) },
      name,
      clients: ["opencode"],
      sourcePath: command,
      mcp: { command, args, env: spec.environment ?? {} },
    });
  }

  for (const entry of parsed.plugin ?? []) {
    // Tuple form is `[name, options]`; the name is all that identifies the plugin.
    const spec = typeof entry === "string" ? entry : typeof entry?.[0] === "string" ? (entry[0] as string) : undefined;
    if (!spec) continue;
    components.push({
      id: { kind: "plugin", key: `${spec}@opencode` },
      name: spec,
      clients: ["opencode"],
      sourcePath: spec,
    });
  }

  return { components, available: true };
}
