import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tryParseJson } from "../util/exec.js";
import { mcpServerFingerprint } from "../util/fingerprint.js";
import type { ClientId, Component } from "../domain/types.js";

export interface McpJsonFile {
  readonly mcpServers?: Readonly<
    Record<
      string,
      { readonly command?: string; readonly args?: readonly string[]; readonly env?: Readonly<Record<string, string>> }
    >
  >;
}

/**
 * Reads the `{"mcpServers": {...}}` file format, which several Clients share verbatim:
 * Claude Code's `.mcp.json` and per-project entries in `~/.claude.json`, and every config
 * layer Pi's `pi-mcp-adapter` reads (`.mcp.json`, `~/.config/mcp/mcp.json`,
 * `~/.pi/agent/mcp.json`, `.pi/mcp.json`).
 *
 * A missing or unparseable file yields no Components rather than an error: an MCP config
 * that isn't there is a discovery fact, not a failure.
 */
export function componentsFromMcpServers(
  servers: McpJsonFile["mcpServers"],
  client: ClientId,
  sourcePath: string,
): Component[] {
  const components: Component[] = [];
  for (const [name, spec] of Object.entries(servers ?? {})) {
    if (!spec.command) continue;
    const args = spec.args ?? [];
    components.push({
      id: { kind: "mcp-server", key: mcpServerFingerprint(spec.command, args) },
      name,
      clients: [client],
      sourcePath,
      mcp: { command: spec.command, args, env: spec.env ?? {} },
    });
  }
  return components;
}

export async function readMcpServersFromFile(path: string, client: ClientId): Promise<Component[]> {
  if (!existsSync(path)) return [];
  const contents = await readFile(path, "utf8").catch(() => undefined);
  if (!contents) return [];
  const parsed = tryParseJson(contents) as McpJsonFile | undefined;
  return componentsFromMcpServers(parsed?.mcpServers, client, path);
}
