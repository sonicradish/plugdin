import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommand };
});

const { explain, UnknownLoadoutError } = await import("../src/commands/explain.js");
const { formatExplain } = await import("../src/commands/format-explain.js");
const { projectLoadoutsDir } = await import("../src/loadout/store.js");

describe("explain", () => {
  let cwd: string;
  let claudeHome: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "pluggedin-cwd-"));
    claudeHome = await mkdtemp(join(tmpdir(), "pluggedin-claude-home-"));
    runClientCommand.mockImplementation(async (bin: string, args: readonly string[]) => {
      if (bin === "claude" && args.join(" ") === "plugin list --json") return { available: true, stdout: "[]", stderr: "" };
      if (bin === "codex" && args.join(" ") === "plugin list --json") return { available: true, stdout: JSON.stringify({ installed: [] }), stderr: "" };
      if (bin === "codex" && args.join(" ") === "mcp list --json") return { available: true, stdout: "[]", stderr: "" };
      throw new Error(`unexpected command in test: ${bin} ${args.join(" ")}`);
    });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(claudeHome, { recursive: true, force: true });
  });

  it("defaults to the built-in 'all' Loadout when the project declares no default", async () => {
    const result = await explain(cwd, undefined, claudeHome);
    expect(result.loadoutName).toBe("all");
  });

  it("throws UnknownLoadoutError for a name that resolves to nothing", async () => {
    await expect(explain(cwd, "does-not-exist", claudeHome)).rejects.toThrow(UnknownLoadoutError);
  });

  it("resolves a real skill Component against a project Loadout and turns it off", async () => {
    await mkdir(join(claudeHome, "skills", "tdd"), { recursive: true });
    await writeFile(join(claudeHome, "skills", "tdd", "SKILL.md"), `---\nname: tdd\ndescription: d\n---\n`);

    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "minimal.toml"), `baseline = "none"\n`);

    const result = await explain(cwd, "minimal", claudeHome);
    expect(result.resolution.decisions.get("tdd@skills-dir")).toBe(false);

    const claudeProjection = result.projections["claude-code"];
    expect(claudeProjection.refusals).toHaveLength(1); // unannotated skill, can't actually be turned off
    expect(claudeProjection.refusals[0]?.reason).toMatch(/adopt/);

    const codexProjection = result.projections.codex;
    expect(codexProjection.args).toEqual(["-c", 'skills.config=[{name="tdd",enabled=false}]']);
  });

  it("reports explicit allow/deny keys but not Components left at the baseline default", async () => {
    await mkdir(join(claudeHome, "skills", "tdd"), { recursive: true });
    await writeFile(join(claudeHome, "skills", "tdd", "SKILL.md"), `---\nname: tdd\ndescription: d\n---\n`);
    await mkdir(join(claudeHome, "skills", "grilling"), { recursive: true });
    await writeFile(join(claudeHome, "skills", "grilling", "SKILL.md"), `---\nname: grilling\ndescription: d\n---\n`);

    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "minimal.toml"), `baseline = "all"\ndeny = ["tdd@skills-dir"]\n`);

    const result = await explain(cwd, "minimal", claudeHome);
    expect(result.explicitKeys.has("tdd@skills-dir")).toBe(true);
    expect(result.explicitKeys.has("grilling@skills-dir")).toBe(false);
  });

  it("performs no filesystem writes — generated file contents are only ever returned in memory", async () => {
    const before = await import("node:fs/promises").then((fs) => fs.readdir(tmpdir()).catch(() => []));
    await explain(cwd, undefined, claudeHome);
    const after = await import("node:fs/promises").then((fs) => fs.readdir(tmpdir()));
    // Nothing named after our preview dir should have been created.
    expect(after.filter((n) => n === "pluggedin").length).toBe(before.filter((n) => n === "pluggedin").length);
  });
});

describe("formatExplain", () => {
  it("renders REFUSED entries and the run-would-refuse footer when any Projection has refusals", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pluggedin-cwd-"));
    const claudeHome = await mkdtemp(join(tmpdir(), "pluggedin-claude-home-"));
    try {
      await mkdir(join(claudeHome, "skills", "tdd"), { recursive: true });
      await writeFile(join(claudeHome, "skills", "tdd", "SKILL.md"), `---\nname: tdd\ndescription: d\n---\n`);
      runClientCommand.mockImplementation(async (bin: string, args: readonly string[]) => {
        if (bin === "claude") return { available: true, stdout: "[]", stderr: "" };
        if (bin === "codex" && args.join(" ") === "plugin list --json") return { available: true, stdout: JSON.stringify({ installed: [] }), stderr: "" };
        return { available: true, stdout: "[]", stderr: "" };
      });

      const result = await explain(cwd, "none", claudeHome);
      const text = formatExplain(result);
      expect(text).toContain("REFUSED");
      expect(text).toContain("pluggedin run would refuse to launch");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
    }
  });

  it("labels each Component 'explicit' or 'baseline default' to match how it ended up on/off", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pluggedin-cwd-"));
    const claudeHome = await mkdtemp(join(tmpdir(), "pluggedin-claude-home-"));
    try {
      await mkdir(join(claudeHome, "skills", "tdd"), { recursive: true });
      await writeFile(join(claudeHome, "skills", "tdd", "SKILL.md"), `---\nname: tdd\ndescription: d\n---\n`);
      await mkdir(join(claudeHome, "skills", "grilling"), { recursive: true });
      await writeFile(join(claudeHome, "skills", "grilling", "SKILL.md"), `---\nname: grilling\ndescription: d\n---\n`);
      runClientCommand.mockImplementation(async () => ({ available: true, stdout: "[]", stderr: "" }));

      await mkdir(projectLoadoutsDir(cwd), { recursive: true });
      await writeFile(join(projectLoadoutsDir(cwd), "minimal.toml"), `baseline = "all"\ndeny = ["tdd@skills-dir"]\n`);

      const result = await explain(cwd, "minimal", claudeHome);
      const text = formatExplain(result);
      expect(text).toContain("tdd@skills-dir (explicit)");
      expect(text).toContain("grilling@skills-dir (baseline default)");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
    }
  });

  it("defaults to plain text with no ANSI codes when no options are given", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pluggedin-cwd-"));
    const claudeHome = await mkdtemp(join(tmpdir(), "pluggedin-claude-home-"));
    try {
      runClientCommand.mockImplementation(async () => ({ available: true, stdout: "[]", stderr: "" }));
      const result = await explain(cwd, undefined, claudeHome);
      expect(formatExplain(result)).not.toMatch(/\x1b\[/);
      expect(formatExplain(result, { color: false })).not.toMatch(/\x1b\[/);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
    }
  });

  it("emits ANSI codes around status/section text when color is enabled, without corrupting the text itself", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "pluggedin-cwd-"));
    const claudeHome = await mkdtemp(join(tmpdir(), "pluggedin-claude-home-"));
    try {
      await mkdir(join(claudeHome, "skills", "tdd"), { recursive: true });
      await writeFile(join(claudeHome, "skills", "tdd", "SKILL.md"), `---\nname: tdd\ndescription: d\n---\n`);
      runClientCommand.mockImplementation(async () => ({ available: true, stdout: "[]", stderr: "" }));

      const result = await explain(cwd, "all", claudeHome);
      const colored = formatExplain(result, { color: true });
      const plain = formatExplain(result, { color: false });

      expect(colored).toMatch(/\x1b\[/);
      expect(colored).toContain("tdd@skills-dir"); // the substance survives, unbroken, inside the styled line
      expect(colored).toContain("## Claude Code");
      expect(colored.replace(/\x1b\[[0-9;]*m/g, "")).toBe(plain); // stripped of ANSI, identical to plain output
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(claudeHome, { recursive: true, force: true });
    }
  });
});
