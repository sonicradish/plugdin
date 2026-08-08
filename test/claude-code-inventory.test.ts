import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommand };
});

const { discoverClaudeCodePlugins, discoverClaudeCodeMcpServers } = await import("../src/inventory/claude-code.js");

describe("discoverClaudeCodePlugins", () => {
  it("parses the confirmed empty flat-array shape", async () => {
    runClientCommand.mockResolvedValueOnce({ available: true, stderr: "", stdout: "[]" });
    const result = await discoverClaudeCodePlugins();
    expect(result).toEqual({ components: [], available: true });
  });

  it("accepts a flat array of entries using Codex-style field names as a hedge", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify([
        {
          pluginId: "code-review@claude-plugins-official",
          name: "code-review",
          marketplaceName: "claude-plugins-official",
          installed: true,
          source: { path: "/plugins/code-review" },
        },
      ]),
    });
    const result = await discoverClaudeCodePlugins();
    expect(result.components).toEqual([
      {
        id: { kind: "plugin", key: "code-review@claude-plugins-official" },
        name: "code-review",
        clients: ["claude-code"],
        sourcePath: "/plugins/code-review",
        marketplace: "claude-plugins-official",
      },
    ]);
  });

  it("also accepts an {installed:[...]} wrapper in case Claude Code matches Codex's shape", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify({ installed: [{ pluginId: "tag-only-plugin@some-marketplace" }] }),
    });
    const result = await discoverClaudeCodePlugins();
    expect(result.components).toEqual([
      {
        id: { kind: "plugin", key: "tag-only-plugin@some-marketplace" },
        name: "tag-only-plugin",
        clients: ["claude-code"],
        sourcePath: "tag-only-plugin@some-marketplace",
        marketplace: "some-marketplace",
      },
    ]);
  });

  it("reports unavailable when claude is not on PATH", async () => {
    runClientCommand.mockResolvedValueOnce({ available: false, reason: "claude is not installed or not on PATH" });
    const result = await discoverClaudeCodePlugins();
    expect(result.available).toBe(false);
  });
});

describe("discoverClaudeCodeMcpServers", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "plugged-in-mcp-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("reads MCP servers from the project's .mcp.json", async () => {
    await writeFile(
      join(cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { fixture: { command: "/bin/fixture-server", args: ["--flag"] } } }),
    );
    const result = await discoverClaudeCodeMcpServers(cwd);
    expect(result.available).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      name: "fixture",
      clients: ["claude-code"],
      mcp: { command: "/bin/fixture-server", args: ["--flag"] },
    });
  });

  it("returns no components when there is no .mcp.json and no matching ~/.claude.json project entry", async () => {
    const result = await discoverClaudeCodeMcpServers(cwd);
    expect(result).toEqual({ components: [], available: true });
  });
});
