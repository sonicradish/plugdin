import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { readMcpServersFromFile } from "./mcp-json.js";
import { discoverLooseSkills } from "./skills.js";
import { runClientCommand, tryParseJson } from "../util/exec.js";
import type { Component, PiPackageResources } from "../domain/types.js";
import type { DiscoveryOutcome } from "./codex.js";

/** `~/.pi/agent`, overridable the same way Pi itself overrides it. */
export function piAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

interface PiPackageJson {
  readonly pi?: {
    readonly extensions?: readonly string[];
    readonly skills?: readonly string[];
  };
}

/**
 * `pi list` — "List installed packages from user and project settings". Confirmed live
 * 2026-08-09: a section header per scope (`User packages:` / `Project packages:`) followed
 * by two lines per package, the install spec indented two spaces and its resolved directory
 * indented four:
 *
 * ```
 * User packages:
 *   npm:pi-subagents
 *     /Users/me/.pi/agent/npm/node_modules/pi-subagents
 * ```
 *
 * There is no `--json`, so this parses the text. The resolved directory is the part worth
 * having: Pi packages declare what they contribute in their `package.json` under a `pi`
 * key (`{"pi": {"extensions": ["./src/extension/index.ts"], "skills": ["./skills"]}}`), and
 * those paths are what Projection hands back to Pi as `-e` / `--skill` arguments, since Pi
 * has no per-package enable flag.
 */
export function parsePiPackageList(stdout: string): Array<{ spec: string; dir: string }> {
  const packages: Array<{ spec: string; dir: string }> = [];
  const lines = stdout.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const specMatch = /^ {2}(\S.*)$/.exec(lines[i]!);
    const dirMatch = /^ {4}(\S.*)$/.exec(lines[i + 1] ?? "");
    if (!specMatch || !dirMatch) continue;
    packages.push({ spec: specMatch[1]!.trim(), dir: dirMatch[1]!.trim() });
    i++;
  }
  return packages;
}

async function readPackageResources(dir: string): Promise<PiPackageResources> {
  const contents = await readFile(join(dir, "package.json"), "utf8").catch(() => undefined);
  const parsed = contents ? (tryParseJson(contents) as PiPackageJson | undefined) : undefined;
  const absolute = (relative: string) => (isAbsolute(relative) ? relative : resolve(dir, relative));
  return {
    extensionPaths: (parsed?.pi?.extensions ?? []).map(absolute),
    skillPaths: (parsed?.pi?.skills ?? []).map(absolute),
  };
}

/**
 * Pi packages are this Client's plugin-shaped Component: one installed unit that bundles
 * extensions, skills, and prompt templates. They are keyed `<spec>@pi` — the install spec
 * (`npm:pi-subagents`, `git:github.com/user/repo`) is already Pi's own stable identifier for
 * a package, and unlike a bare name it survives the same name existing on two registries.
 */
export async function discoverPiPackages(cwd: string): Promise<DiscoveryOutcome> {
  const result = await runClientCommand("pi", ["list"], { cwd });
  if (!result.available) return { components: [], available: false, reason: result.reason };

  const packages = parsePiPackageList(result.stdout);
  const components = await Promise.all(
    packages.map(async ({ spec, dir }): Promise<Component> => {
      const piPackage = await readPackageResources(dir);
      return {
        id: { kind: "plugin", key: `${spec}@pi` },
        name: spec,
        clients: ["pi"],
        sourcePath: dir,
        piPackage,
      };
    }),
  );
  return { components, available: true };
}

/**
 * Pi's own loose skill roots. Unlike every other Client here, Pi does NOT read
 * `~/.claude/skills/` — its loader scans `<agentDir>/skills` and `<cwd>/.pi/skills` only
 * (confirmed in Pi's `dist/core/skills.js`) — so these are separate installations that may
 * happen to share a name with a skill another Client sees. They are keyed
 * `<name>@pi-skills` and only merge with the shared roots when they turn out to be the very
 * same files on disk, which `buildInventory` decides by real path.
 */
export async function discoverPiSkills(cwd: string, agentDir = piAgentDir()): Promise<Component[]> {
  const roots = [join(agentDir, "skills"), join(cwd, ".pi", "skills")];
  const byKey = new Map<string, Component>();
  for (const root of roots) {
    for (const skill of await discoverLooseSkills(root)) {
      byKey.set(skill.name, {
        id: { kind: "skill", key: `${skill.name}@pi-skills` },
        name: skill.name,
        clients: ["pi"],
        sourcePath: skill.dir,
        description: skill.description,
        // Annotation is a Claude Code compatibility shim (ADR-0003); Pi addresses skills by
        // path on the command line and never needs one.
        annotation: "not-applicable",
      });
    }
  }
  return [...byKey.values()];
}

/**
 * MCP servers Pi can see. Pi has no native MCP: the `pi-mcp-adapter` extension provides it,
 * reading four layers that all use the shared `{"mcpServers": {...}}` format — the standard
 * user-global `~/.config/mcp/mcp.json` and project `.mcp.json`, plus Pi-owned overrides at
 * `<agentDir>/mcp.json` and `.pi/mcp.json` (documented in the adapter's README and read from
 * its `config.ts`). Later layers win on name collisions, which is the order used here.
 *
 * The project `.mcp.json` is the same file Claude Code reads, so a server configured there
 * is one Component discovered under both Clients, not two.
 */
export async function discoverPiMcpServers(cwd: string, agentDir = piAgentDir()): Promise<Component[]> {
  const layers = [
    join(homedir(), ".config", "mcp", "mcp.json"),
    join(agentDir, "mcp.json"),
    join(cwd, ".mcp.json"),
    join(cwd, ".pi", "mcp.json"),
  ];
  const byName = new Map<string, Component>();
  for (const layer of layers) {
    for (const component of await readMcpServersFromFile(layer, "pi")) {
      byName.set(component.name, component);
    }
  }
  return [...byName.values()];
}
