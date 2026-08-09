import { describe, expect, it, vi } from "vitest";

const { runClientCommand, runClientCommandToFile } = vi.hoisted(() => ({
  runClientCommand: vi.fn(),
  runClientCommandToFile: vi.fn(),
}));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommand, runClientCommandToFile };
});

const { discoverGrokComponents, discoverGrokMcpServers } = await import("../src/inventory/grok.js");

function inspectOutput(body: Record<string, unknown>) {
  return { available: true, stderr: "", stdout: JSON.stringify(body) };
}

describe("discoverGrokComponents", () => {
  it("keys a skill by name and records the directory above the SKILL.md Grok reported", async () => {
    runClientCommandToFile.mockResolvedValueOnce(
      inspectOutput({
        skills: [
          {
            name: "tdd",
            description: "Test-driven development.",
            source: { type: "user", path: "/Users/me/.agents/skills/tdd/SKILL.md" },
          },
        ],
        plugins: [],
      }),
    );

    const result = await discoverGrokComponents();
    expect(result.available).toBe(true);
    expect(result.components).toEqual([
      {
        id: { kind: "skill", key: "tdd@grok-skills" },
        name: "tdd",
        clients: ["grok"],
        sourcePath: "/Users/me/.agents/skills/tdd",
        // Grok's own spelling is kept separately: it is the only path `[skills] ignore` matches.
        clientPaths: { grok: ["/Users/me/.agents/skills/tdd"] },
        annotation: "not-applicable",
        description: "Test-driven development.",
      },
    ]);
  });

  it("reports bundled skills too, since they are toggleable by path like any other", async () => {
    runClientCommandToFile.mockResolvedValueOnce(
      inspectOutput({
        skills: [{ name: "design", source: { type: "bundled", path: "/Users/me/.grok/bundled/skills/design/SKILL.md" } }],
      }),
    );

    const result = await discoverGrokComponents();
    expect(result.components[0]?.sourcePath).toBe("/Users/me/.grok/bundled/skills/design");
  });

  it("accepts either field name for a plugin id, since the populated shape is unverified", async () => {
    runClientCommandToFile.mockResolvedValueOnce(
      inspectOutput({ skills: [], plugins: [{ pluginId: "noisy@xai", name: "noisy", marketplaceName: "xai" }] }),
    );

    const result = await discoverGrokComponents();
    expect(result.components).toEqual([
      { id: { kind: "plugin", key: "noisy@xai" }, name: "noisy", clients: ["grok"], sourcePath: "noisy@xai", marketplace: "xai" },
    ]);
  });

  it("treats output that is not an inspect object as unavailable rather than as an empty Inventory", async () => {
    runClientCommandToFile.mockResolvedValueOnce({ available: true, stderr: "", stdout: "[]" });
    const result = await discoverGrokComponents();
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/unexpected/);
  });

  it("reports unavailable when grok is not on PATH", async () => {
    runClientCommandToFile.mockResolvedValueOnce({ available: false, reason: "grok is not installed or not on PATH" });
    const result = await discoverGrokComponents();
    expect(result).toEqual({ components: [], available: false, reason: "grok is not installed or not on PATH" });
  });
});

describe("discoverGrokMcpServers", () => {
  it("parses the flat {name, command, args, env} shape into fingerprinted Components", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify([{ name: "probe", command: "echo", args: ["hi"], env: { FOO: "bar" }, enabled: true, scope: "user" }]),
    });

    const result = await discoverGrokMcpServers();
    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({
      name: "probe",
      clients: ["grok"],
      mcp: { command: "echo", args: ["hi"], env: { FOO: "bar" } },
    });
    expect(result.components[0]?.id.kind).toBe("mcp-server");
  });

  it("keeps a server Grok has already disabled, so a Loadout can turn it back on", async () => {
    runClientCommand.mockResolvedValueOnce({
      available: true,
      stderr: "",
      stdout: JSON.stringify([{ name: "off-server", command: "srv", args: [], enabled: false, scope: "user" }]),
    });

    const result = await discoverGrokMcpServers();
    expect(result.components).toHaveLength(1);
    expect(result.components[0]?.name).toBe("off-server");
  });
});
