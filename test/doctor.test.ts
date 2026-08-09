import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeAnnotation } from "../src/adopt/annotate.js";
import { projectLoadoutsDir } from "../src/loadout/store.js";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  // Both entry points share one implementation: which of the two an adapter uses is an
  // internal detail (large outputs bypass the pipe), not something a test should have to know.
  return { ...actual, runClientCommand, runClientCommandToFile: runClientCommand };
});

const { doctor } = await import("../src/commands/doctor.js");

describe("doctor", () => {
  let cwd: string;
  let claudeHome: string;
  let plugdinHome: string;
  let originalPlugdinHome: string | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "plugdin-cwd-"));
    claudeHome = await mkdtemp(join(tmpdir(), "plugdin-claude-home-"));
    plugdinHome = await mkdtemp(join(tmpdir(), "plugdin-home-"));
    originalPlugdinHome = process.env.PLUGDIN_HOME;
    process.env.PLUGDIN_HOME = plugdinHome; // isolate from the real ~/.plugdin
    runClientCommand.mockImplementation(async (bin: string, args: readonly string[]) => {
      if (bin === "claude") return { available: true, stdout: "[]", stderr: "" };
      if (bin === "codex" && args.join(" ") === "plugin list --json") return { available: true, stdout: JSON.stringify({ installed: [] }), stderr: "" };
      return { available: true, stdout: "[]", stderr: "" };
    });
  });

  afterEach(async () => {
    if (originalPlugdinHome === undefined) delete process.env.PLUGDIN_HOME;
    else process.env.PLUGDIN_HOME = originalPlugdinHome;
    await rm(cwd, { recursive: true, force: true });
    await rm(claudeHome, { recursive: true, force: true });
    await rm(plugdinHome, { recursive: true, force: true });
  });

  async function makeSkill(root: string, name: string, description = "d") {
    const dir = join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n`);
    return dir;
  }

  it("reports an unannotated skill", async () => {
    await makeSkill(join(claudeHome, "skills"), "tdd");
    const report = await doctor(cwd, claudeHome);
    expect(report.unannotatedSkills.map((c) => c.id.key)).toEqual(["tdd@skills-dir"]);
    expect(report.driftedAnnotations).toEqual([]);
    expect(report.foreignAnnotations).toEqual([]);
    expect(report.collisions).toEqual([]);
  });

  it("does not flag a properly annotated skill", async () => {
    const dir = await makeSkill(join(claudeHome, "skills"), "tdd");
    await writeAnnotation(dir, "tdd", "d");
    const report = await doctor(cwd, claudeHome);
    expect(report.unannotatedSkills).toEqual([]);
    expect(report.driftedAnnotations).toEqual([]);
  });

  it("flags drift when the Annotation's name no longer matches the skill's current name", async () => {
    const dir = await makeSkill(join(claudeHome, "skills"), "tdd");
    await writeAnnotation(dir, "old-name", "d"); // simulates a rename after Annotation was written
    const report = await doctor(cwd, claudeHome);
    expect(report.driftedAnnotations).toHaveLength(1);
    expect(report.driftedAnnotations[0]).toMatchObject({ manifestName: "old-name" });
    expect(report.driftedAnnotations[0]?.component.name).toBe("tdd");
  });

  it("flags a foreign (non-plugdin) plugin.json without touching it", async () => {
    const dir = await makeSkill(join(claudeHome, "skills"), "tdd");
    await mkdir(join(dir, ".claude-plugin"), { recursive: true });
    await writeFile(join(dir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "hand-authored" }));
    const report = await doctor(cwd, claudeHome);
    expect(report.foreignAnnotations.map((c) => c.id.key)).toEqual(["tdd@skills-dir"]);
    expect(report.unannotatedSkills).toEqual([]);
  });

  it("flags a collision when the same skill name exists under both global and project roots", async () => {
    await makeSkill(join(claudeHome, "skills"), "tdd");
    await makeSkill(join(cwd, ".claude", "skills"), "tdd");
    const report = await doctor(cwd, claudeHome);
    expect(report.collisions).toHaveLength(1);
    expect(report.collisions[0]?.key).toBe("tdd@skills-dir");
    expect(report.collisions[0]?.paths).toHaveLength(2);
  });

  it("surfaces discovery warnings from buildInventory", async () => {
    runClientCommand.mockResolvedValue({ available: false, reason: "not installed" });
    const report = await doctor(cwd, claudeHome);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("flags an allow/deny key in a Loadout that matches no discovered Component", async () => {
    await makeSkill(join(claudeHome, "skills"), "tdd");
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(
      join(projectLoadoutsDir(cwd), "typo.toml"),
      `baseline = "none"\nallow = ["tdd@skills-dir", "tdd@skils-dir"]\ndeny = ["nonexistent-plugin@some-marketplace"]\n`,
    );

    const report = await doctor(cwd, claudeHome);
    expect(report.unknownLoadoutKeys).toHaveLength(2);
    expect(report.unknownLoadoutKeys).toContainEqual(
      expect.objectContaining({ loadoutName: "typo", field: "allow", key: "tdd@skils-dir" }),
    );
    expect(report.unknownLoadoutKeys).toContainEqual(
      expect.objectContaining({ loadoutName: "typo", field: "deny", key: "nonexistent-plugin@some-marketplace" }),
    );
  });

  it("does not flag Loadout keys that match a real Component", async () => {
    await makeSkill(join(claudeHome, "skills"), "tdd");
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "clean.toml"), `baseline = "none"\nallow = ["tdd@skills-dir"]\n`);

    const report = await doctor(cwd, claudeHome);
    expect(report.unknownLoadoutKeys).toEqual([]);
  });

  it("checks every Loadout file, not just one", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "a.toml"), `allow = ["missing-a@x"]\n`);
    await writeFile(join(projectLoadoutsDir(cwd), "b.toml"), `allow = ["missing-b@x"]\n`);

    const report = await doctor(cwd, claudeHome);
    expect(report.unknownLoadoutKeys.map((u) => u.key).sort()).toEqual(["missing-a@x", "missing-b@x"]);
  });
});
