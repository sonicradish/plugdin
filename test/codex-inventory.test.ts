import { describe, expect, it, vi } from "vitest";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommand };
});

const { discoverCodexPlugins, discoverCodexMcpServers } = await import("../src/inventory/codex.js");

describe("discoverCodexPlugins", () => {
  it("parses the real {installed:[...]} shape into plugin Components keyed by pluginId", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify({
        installed: [
          {
            pluginId: "documents@openai-primary-runtime",
            name: "documents",
            marketplaceName: "openai-primary-runtime",
            installed: true,
            enabled: true,
            source: { path: "/plugins/documents" },
          },
        ],
      }),
    });

    const result = await discoverCodexPlugins();
    expect(result.available).toBe(true);
    expect(result.components).toEqual([
      {
        id: { kind: "plugin", key: "documents@openai-primary-runtime" },
        name: "documents",
        clients: ["codex"],
        sourcePath: "/plugins/documents",
        marketplace: "openai-primary-runtime",
      },
    ]);
  });

  it("excludes entries explicitly marked installed:false", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify({
        installed: [
          { pluginId: "chrome@openai-bundled", name: "chrome", marketplaceName: "openai-bundled", installed: false },
        ],
      }),
    });

    const result = await discoverCodexPlugins();
    expect(result.components).toEqual([]);
  });

  it("reports unavailable when codex is not on PATH", async () => {
    runClientCommand.mockResolvedValueOnce({ available: false, reason: "codex is not installed or not on PATH" });
    const result = await discoverCodexPlugins();
    expect(result).toEqual({ components: [], available: false, reason: "codex is not installed or not on PATH" });
  });

  it("flags an unrecognized JSON shape rather than silently returning nothing", async () => {
    runClientCommand.mockResolvedValueOnce({ available: true, stderr: "", stdout: "[]" });
    const result = await discoverCodexPlugins();
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/unexpected/);
  });
});

describe("discoverCodexMcpServers", () => {
  it("parses the real flat-array shape into mcp-server Components, fingerprinted from command+args", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify([
        {
          name: "node_repl",
          enabled: true,
          transport: { type: "stdio", command: "/bin/node_repl", args: [], env: { FOO: "bar" } },
        },
      ]),
    });

    const result = await discoverCodexMcpServers();
    expect(result.available).toBe(true);
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      id: { kind: "mcp-server" },
      name: "node_repl",
      clients: ["codex"],
      sourcePath: "/bin/node_repl",
      mcp: { command: "/bin/node_repl", args: [], env: { FOO: "bar" } },
    });
  });

  it("skips entries with no launch command", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify([{ name: "broken", transport: {} }]),
    });
    const result = await discoverCodexMcpServers();
    expect(result.components).toEqual([]);
  });
});
