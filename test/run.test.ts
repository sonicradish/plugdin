import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  // Both entry points share one implementation: which of the two an adapter uses is an
  // internal detail (large outputs bypass the pipe), not something a test should have to know.
  return { ...actual, runClientCommand, runClientCommandToFile: runClientCommand };
});

const { normalizeClientArg, parseRunArgs, prepareRun, RefusedToLaunchError, RenamedFlagError, execRun } = await import("../src/commands/run.js");
const { UnknownProfileError } = await import("../src/commands/explain.js");

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
  it("passes everything through untouched when --profile is absent", () => {
    expect(parseRunArgs(["-p", "hello", "--model", "sonnet"])).toEqual({
      passthroughArgs: ["-p", "hello", "--model", "sonnet"],
    });
  });

  it("extracts a space-separated --profile value and removes both tokens", () => {
    expect(parseRunArgs(["--profile", "dev", "-p", "hi"])).toEqual({
      profileName: "dev",
      passthroughArgs: ["-p", "hi"],
    });
  });

  it("rejects the old --loadout name instead of forwarding it to the Client", () => {
    expect(() => parseRunArgs(["--loadout", "dev"])).toThrow(RenamedFlagError);
    expect(() => parseRunArgs(["--loadout=dev"])).toThrow(/renamed to --profile/);
  });

  it("extracts an --profile=value form", () => {
    expect(parseRunArgs(["--profile=dev", "-p", "hi"])).toEqual({
      profileName: "dev",
      passthroughArgs: ["-p", "hi"],
    });
  });

  it("preserves passthrough argument order regardless of where --profile appears", () => {
    expect(parseRunArgs(["-p", "hi", "--profile", "dev", "--model", "sonnet"])).toEqual({
      profileName: "dev",
      passthroughArgs: ["-p", "hi", "--model", "sonnet"],
    });
  });
});

describe("prepareRun", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "plugdin-run-cwd-"));
    runClientCommand.mockImplementation(async (bin: string, args: readonly string[]) => {
      if (bin === "claude") return { available: true, stdout: "[]", stderr: "" };
      if (bin === "codex" && args.join(" ") === "plugin list --json") return { available: true, stdout: JSON.stringify({ installed: [] }), stderr: "" };
      return { available: true, stdout: "[]", stderr: "" };
    });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("resolves the default Profile ('all') and passes native args through after Projection args", async () => {
    const prepared = await prepareRun(cwd, "codex", undefined, ["-p", "hello"]);
    expect(prepared.profileName).toBe("all");
    expect(prepared.binary).toBe("codex");
    expect(prepared.nativeArgs.slice(-2)).toEqual(["-p", "hello"]);
  });

  it("throws UnknownProfileError for a Profile name that doesn't exist", async () => {
    await expect(prepareRun(cwd, "codex", "no-such-profile", [])).rejects.toThrow(UnknownProfileError);
  });

  it("computes claude-code settings/mcp-config file paths under a fresh temp dir", async () => {
    const prepared = await prepareRun(cwd, "claude-code", "all", []);
    expect(prepared.projection.generatedFiles.map((f) => f.path).every((p) => p.includes("plugdin-run-"))).toBe(true);
  });
});

describe("execRun", () => {
  it("throws RefusedToLaunchError and does not spawn anything when the Projection has refusals", async () => {
    const prepared = {
      client: "claude-code" as const,
      binary: "claude",
      profileName: "all",
      projection: {
        client: "claude-code" as const,
        args: [],
        env: {},
        generatedFiles: [],
        mirrors: [],
        refusals: [{ component: { kind: "skill" as const, key: "x@skills-dir" }, reason: "needs adopt" }],
        warnings: [],
        notes: [],
      },
      nativeArgs: [],
    };
    await expect(execRun(prepared)).rejects.toThrow(RefusedToLaunchError);
  });

  it("does not throw and still launches when the Projection only has warnings (non-blocking)", async () => {
    const prepared = {
      client: "codex" as const,
      binary: "true", // a real, harmless binary that just exits 0 — proves execRun didn't refuse
      profileName: "all",
      projection: {
        client: "codex" as const,
        args: [],
        env: {},
        generatedFiles: [],
        mirrors: [],
        refusals: [],
        warnings: [{ component: { kind: "mcp-server" as const, key: "srv-1" }, reason: "no faithful way to disable it" }],
        notes: [],
      },
      nativeArgs: [],
    };
    await expect(execRun(prepared)).resolves.toBe(0);
  });
});
