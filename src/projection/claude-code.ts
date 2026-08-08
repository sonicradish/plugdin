import { join } from "node:path";
import type { Activation, GeneratedFile, Projection, Refusal } from "../domain/types.js";

interface ClaudeCodeSettings {
  readonly enabledPlugins: Record<string, boolean>;
}

interface McpConfigFile {
  readonly mcpServers: Record<string, { readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> }>;
}

/**
 * Claude Code Projection (PLAN.md Phase 3): an `enabledPlugins` map for `--settings`, and a
 * surviving MCP server set for `--mcp-config` + `--strict-mcp-config`. `workDir` is where the
 * generated files' paths point — this function does no filesystem I/O itself (see
 * `materializeProjection`), so `explain` can preview it without writing anything.
 */
export function projectClaudeCode(activation: Activation, workDir: string): Projection {
  const { inventory, loadout } = activation;
  const decisions = loadout.decisions;

  const enabledPlugins: Record<string, boolean> = {};
  const mcpServers: McpConfigFile["mcpServers"] = {};
  const refusals: Refusal[] = [];

  for (const component of inventory.components) {
    if (!component.clients.includes("claude-code")) continue;
    const decision = decisions.get(component.id.key) ?? false;

    if (component.id.kind === "plugin") {
      enabledPlugins[component.id.key] = decision;
      continue;
    }

    if (component.id.kind === "skill") {
      if (component.annotation === "annotated") {
        // Annotated skills load as `<name>@skills-dir` plugins (ADR-0003).
        enabledPlugins[component.id.key] = decision;
      } else if (!decision) {
        // Loose, unannotated skills have no filter on Claude Code (ADR-0001) — turning one
        // off is a request Projection cannot satisfy, not something to silently ignore.
        refusals.push({ component: component.id, reason: "skill is not Annotated; run `plugged-in adopt` before it can be turned off for Claude Code" });
      }
      continue;
    }

    if (component.id.kind === "mcp-server") {
      if (!decision) continue;
      if (!component.mcp) {
        refusals.push({ component: component.id, reason: "no launch spec captured for this MCP server; cannot round-trip it into --mcp-config" });
        continue;
      }
      mcpServers[component.name] = { command: component.mcp.command, args: component.mcp.args, env: component.mcp.env };
    }
  }

  const settingsFile: GeneratedFile = {
    path: join(workDir, "settings.json"),
    purpose: "--settings: ephemeral enabledPlugins overlay",
    contents: JSON.stringify({ enabledPlugins } satisfies ClaudeCodeSettings, null, 2) + "\n",
  };
  const mcpConfigFile: GeneratedFile = {
    path: join(workDir, "mcp-config.json"),
    purpose: "--mcp-config: the complete surviving MCP server set (paired with --strict-mcp-config)",
    contents: JSON.stringify({ mcpServers } satisfies McpConfigFile, null, 2) + "\n",
  };

  const args = [
    "--settings",
    settingsFile.path,
    "--mcp-config",
    mcpConfigFile.path,
    "--strict-mcp-config",
  ];

  return {
    client: "claude-code",
    args,
    generatedFiles: [settingsFile, mcpConfigFile],
    refusals,
  };
}
