import { describe, expect, it, vi } from "vitest";

const { runClientCommandToFile } = vi.hoisted(() => ({ runClientCommandToFile: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommandToFile };
});

const { discoverOpenCodeConfig, discoverOpenCodeSkills } = await import("../src/inventory/opencode.js");

const ok = (body: unknown) => ({ available: true, stderr: "", stdout: JSON.stringify(body) });

describe("discoverOpenCodeSkills", () => {
  it("records the directory above a skill's SKILL.md so it can reconcile with the shared roots", async () => {
    runClientCommandToFile.mockResolvedValueOnce(
      ok([{ name: "tdd", description: "Test-driven development.", location: "/Users/me/.agents/skills/tdd/SKILL.md", content: "…" }]),
    );

    const result = await discoverOpenCodeSkills();
    expect(result.components).toEqual([
      {
        id: { kind: "skill", key: "tdd@opencode-skills" },
        name: "tdd",
        clients: ["opencode"],
        sourcePath: "/Users/me/.agents/skills/tdd",
        // Not "unannotated": `adopt` would do nothing for OpenCode. A skill that IS a Claude
        // Code skill gets its real Annotation state from the shared-root Component it
        // reconciles with.
        annotation: "not-applicable",
        description: "Test-driven development.",
      },
    ]);
  });

  it("marks a built-in skill as such rather than inventing a path for it", async () => {
    runClientCommandToFile.mockResolvedValueOnce(ok([{ name: "customize-opencode", description: "…", location: "<built-in>" }]));
    const result = await discoverOpenCodeSkills();
    expect(result.components[0]).toMatchObject({ sourcePath: "<built-in>", annotation: "not-applicable" });
  });

  it("reports unavailable when the output does not parse, instead of claiming zero skills", async () => {
    // The real failure mode this guards: opencode truncates a large stdout pipe mid-string.
    runClientCommandToFile.mockResolvedValueOnce({ available: true, stderr: "", stdout: '[{"name":"tdd","content":"trunca' });
    const result = await discoverOpenCodeSkills();
    expect(result.available).toBe(false);
    expect(result.components).toEqual([]);
  });
});

describe("discoverOpenCodeConfig", () => {
  it("splits a local server's single command array into command and args", async () => {
    runClientCommandToFile.mockResolvedValueOnce(
      ok({ mcp: { playwright: { type: "local", command: ["npx", "-y", "@playwright/mcp"], environment: { BROWSER: "chromium" } } } }),
    );

    const result = await discoverOpenCodeConfig();
    expect(result.components[0]).toMatchObject({
      name: "playwright",
      clients: ["opencode"],
      mcp: { command: "npx", args: ["-y", "@playwright/mcp"], env: { BROWSER: "chromium" } },
    });
  });

  it("fingerprints a remote server on its URL, which is all it has", async () => {
    runClientCommandToFile.mockResolvedValueOnce(ok({ mcp: { github: { type: "remote", url: "https://example.test/mcp" } } }));
    const result = await discoverOpenCodeConfig();
    expect(result.components[0]).toMatchObject({ name: "github", mcp: { command: "https://example.test/mcp", args: [] } });
  });

  it("reads plugins in both the bare-spec and [spec, options] tuple forms", async () => {
    runClientCommandToFile.mockResolvedValueOnce(ok({ plugin: ["opencode-gemini-auth", ["opencode-bar", { option: "value" }]] }));
    const result = await discoverOpenCodeConfig();
    expect(result.components.map((c) => c.id.key)).toEqual(["opencode-gemini-auth@opencode", "opencode-bar@opencode"]);
  });

  it("treats a config with no mcp or plugin keys as a successful, empty discovery", async () => {
    runClientCommandToFile.mockResolvedValueOnce(ok({ $schema: "https://opencode.ai/config.json", agent: {}, username: "me" }));
    const result = await discoverOpenCodeConfig();
    expect(result).toEqual({ components: [], available: true });
  });
});
