import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommand };
});

const { normalizeClientArg, parseRunArgs, prepareRun, RefusedToLaunchError, execRun } = await import("../src/commands/run.js");
const { UnknownLoadoutError } = await import("../src/commands/explain.js");

describe("normalizeClientArg", () => {
  it('accepts "claude" as an alias for "claude-code"', () => {
    expect(normalizeClientArg("claude")).toBe("claude-code");
  });

  it('accepts the canonical "claude-code" spelling', () => {
    expect(normalizeClientArg("claude-code")).toBe("claude-code");
  });

  it('accepts "codex" unchanged', () => {
    expect(normalizeClientArg("codex")).toBe("codex");
  });

  it("returns undefined for anything else", () => {
    expect(normalizeClientArg("gpt")).toBeUndefined();
    expect(normalizeClientArg("")).toBeUndefined();
    expect(normalizeClientArg("Claude")).toBeUndefined(); // case-sensitive, matches argv verbatim
  });
});

describe("parseRunArgs", () => {
  it("passes everything through untouched when --loadout is absent", () => {
    expect(parseRunArgs(["-p", "hello", "--model", "sonnet"])).toEqual({
      passthroughArgs: ["-p", "hello", "--model", "sonnet"],
    });
  });

  it("extracts a space-separated --loadout value and removes both tokens", () => {
    expect(parseRunArgs(["--loadout", "dev", "-p", "hi"])).toEqual({
      loadoutName: "dev",
      passthroughArgs: ["-p", "hi"],
    });
  });

  it("extracts an --loadout=value form", () => {
    expect(parseRunArgs(["--loadout=dev", "-p", "hi"])).toEqual({
      loadoutName: "dev",
      passthroughArgs: ["-p", "hi"],
    });
  });

  it("preserves passthrough argument order regardless of where --loadout appears", () => {
    expect(parseRunArgs(["-p", "hi", "--loadout", "dev", "--model", "sonnet"])).toEqual({
      loadoutName: "dev",
      passthroughArgs: ["-p", "hi", "--model", "sonnet"],
    });
  });
});

describe("prepareRun", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "pluggedin-run-cwd-"));
    runClientCommand.mockImplementation(async (bin: string, args: readonly string[]) => {
      if (bin === "claude") return { available: true, stdout: "[]", stderr: "" };
      if (bin === "codex" && args.join(" ") === "plugin list --json") return { available: true, stdout: JSON.stringify({ installed: [] }), stderr: "" };
      return { available: true, stdout: "[]", stderr: "" };
    });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("resolves the default Loadout ('all') and passes native args through after Projection args", async () => {
    const prepared = await prepareRun(cwd, "codex", undefined, ["-p", "hello"]);
    expect(prepared.loadoutName).toBe("all");
    expect(prepared.binary).toBe("codex");
    expect(prepared.nativeArgs.slice(-2)).toEqual(["-p", "hello"]);
  });

  it("throws UnknownLoadoutError for a Loadout name that doesn't exist", async () => {
    await expect(prepareRun(cwd, "codex", "no-such-loadout", [])).rejects.toThrow(UnknownLoadoutError);
  });

  it("computes claude-code settings/mcp-config file paths under a fresh temp dir", async () => {
    const prepared = await prepareRun(cwd, "claude-code", "all", []);
    expect(prepared.projection.generatedFiles.map((f) => f.path).every((p) => p.includes("pluggedin-run-"))).toBe(true);
  });
});

describe("execRun", () => {
  it("throws RefusedToLaunchError and does not spawn anything when the Projection has refusals", async () => {
    const prepared = {
      client: "claude-code" as const,
      binary: "claude",
      loadoutName: "all",
      projection: {
        client: "claude-code" as const,
        args: [],
        generatedFiles: [],
        refusals: [{ component: { kind: "skill" as const, key: "x@skills-dir" }, reason: "needs adopt" }],
      },
      nativeArgs: [],
    };
    await expect(execRun(prepared)).rejects.toThrow(RefusedToLaunchError);
  });
});
