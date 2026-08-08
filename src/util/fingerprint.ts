import { createHash } from "node:crypto";
import { basename } from "node:path";

/**
 * Canonical identity for an MCP server: PLAN.md calls for a "command+args fingerprint,
 * with user-pinnable aliases" since, unlike plugins, MCP servers have no natural
 * `name@marketplace` key. Env is deliberately excluded — the same server relaunched with a
 * refreshed token/secret must still resolve to the same identity.
 */
export function mcpServerFingerprint(command: string, args: readonly string[]): string {
  const hash = createHash("sha256").update(JSON.stringify({ command, args })).digest("hex").slice(0, 12);
  return `${basename(command)}-${hash}`;
}
