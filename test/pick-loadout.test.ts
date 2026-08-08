import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePrompter } from "./support/fake-prompter.js";
import { projectLoadoutsDir } from "../src/loadout/store.js";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  return { ...actual, runClientCommand };
});

const { pickOrCreateLoadout } = await import("../src/commands/pick-loadout.js");

describe("pickOrCreateLoadout", () => {
  let cwd: string;
  let claudeHome: string;
  let pluggedInHome: string;
  let originalPluggedInHome: string | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "plugged-in-cwd-"));
    claudeHome = await mkdtemp(join(tmpdir(), "plugged-in-claude-home-"));
    pluggedInHome = await mkdtemp(join(tmpdir(), "plugged-in-home-"));
    originalPluggedInHome = process.env.PLUGGED_IN_HOME;
    process.env.PLUGGED_IN_HOME = pluggedInHome;
    runClientCommand.mockImplementation(async (bin: string, args: readonly string[]) => {
      if (bin === "claude") return { available: true, stdout: "[]", stderr: "" };
      if (bin === "codex" && args.join(" ") === "plugin list --json") return { available: true, stdout: JSON.stringify({ installed: [] }), stderr: "" };
      return { available: true, stdout: "[]", stderr: "" };
    });
  });

  afterEach(async () => {
    if (originalPluggedInHome === undefined) delete process.env.PLUGGED_IN_HOME;
    else process.env.PLUGGED_IN_HOME = originalPluggedInHome;
    await rm(cwd, { recursive: true, force: true });
    await rm(claudeHome, { recursive: true, force: true });
    await rm(pluggedInHome, { recursive: true, force: true });
  });

  async function makeSkill(name: string) {
    const dir = join(claudeHome, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
  }

  it("offers all/none built-ins and Create..., and returns 'all' when chosen", async () => {
    const prompter = new FakePrompter().queueSelect("__plugged_in_all__");
    const result = await pickOrCreateLoadout(cwd, prompter, claudeHome);
    expect(result).toEqual({ loadoutName: "all", created: false });
    expect(prompter.selectPrompts[0]?.options.map((o) => o.value)).toEqual([
      "__plugged_in_all__",
      "__plugged_in_none__",
      "__plugged_in_create__",
    ]);
  });

  it("returns 'none' when chosen", async () => {
    const prompter = new FakePrompter().queueSelect("__plugged_in_none__");
    const result = await pickOrCreateLoadout(cwd, prompter, claudeHome);
    expect(result).toEqual({ loadoutName: "none", created: false });
  });

  it("lists an existing project Loadout as a pickable option and returns it directly", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "dev.toml"), `baseline = "none"\n`);

    const prompter = new FakePrompter().queueSelect("dev");
    const result = await pickOrCreateLoadout(cwd, prompter, claudeHome);
    expect(result).toEqual({ loadoutName: "dev", created: false });
    expect(prompter.selectPrompts[0]?.options[0]).toEqual({ value: "dev", label: "dev (project)" });
  });

  it("creates a new project Loadout with baseline none and hand-picked allow list", async () => {
    await makeSkill("tdd");
    await makeSkill("grilling");

    const prompter = new FakePrompter()
      .queueSelect("__plugged_in_create__") // top-level menu
      .queueInput("my-loadout") // name
      .queueSelect("project") // scope
      .queueSelect("none") // baseline
      .queueToggleResult(new Set(["tdd@skills-dir"])); // turn tdd on, leave grilling off

    const result = await pickOrCreateLoadout(cwd, prompter, claudeHome);
    expect(result.created).toBe(true);
    expect(result.loadoutName).toBe("my-loadout");

    const contents = await readFile(join(projectLoadoutsDir(cwd), "my-loadout.toml"), "utf8");
    expect(contents).toContain('baseline = "none"');
    expect(contents).toContain("tdd@skills-dir");
    expect(contents).not.toContain("grilling@skills-dir");
  });

  it("creates a Loadout with baseline all, computing deny from what got turned off", async () => {
    await makeSkill("tdd");
    await makeSkill("grilling");

    const prompter = new FakePrompter()
      .queueSelect("__plugged_in_create__")
      .queueInput("minus-grilling")
      .queueSelect("project")
      .queueSelect("all")
      .queueToggleResult(new Set(["tdd@skills-dir"])); // grilling started on (baseline all), now off

    await pickOrCreateLoadout(cwd, prompter, claudeHome);
    const contents = await readFile(join(projectLoadoutsDir(cwd), "minus-grilling.toml"), "utf8");
    expect(contents).toContain('baseline = "all"');
    expect(contents).toContain("grilling@skills-dir"); // in deny
    expect(contents).not.toMatch(/allow/); // nothing was turned ON beyond the all baseline
  });

  it("re-prompts for a name when the first one is invalid or already taken", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "taken.toml"), `baseline = "all"\n`);

    const prompter = new FakePrompter()
      .queueSelect("__plugged_in_create__")
      .queueInput("all", "taken", "fresh-name") // "all" is reserved, "taken" already exists
      .queueSelect("project")
      .queueSelect("none");

    const result = await pickOrCreateLoadout(cwd, prompter, claudeHome);
    expect(result.loadoutName).toBe("fresh-name");
    expect(prompter.notes.some((n) => n.includes("Invalid name"))).toBe(true);
    expect(prompter.notes.some((n) => n.includes("already exists"))).toBe(true);
  });

  it("offers existing Loadouts as baseline choices when creating a new one", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "team-default.toml"), `baseline = "none"\nallow = ["tdd@skills-dir"]\n`);
    await makeSkill("tdd");

    const prompter = new FakePrompter()
      .queueSelect("__plugged_in_create__")
      .queueInput("mine")
      .queueSelect("project")
      .queueSelect("team-default");

    await pickOrCreateLoadout(cwd, prompter, claudeHome);
    const baselinePrompt = prompter.selectPrompts.find((p) => p.message === "Baseline");
    expect(baselinePrompt?.options.map((o) => o.value)).toContain("team-default");

    const contents = await readFile(join(projectLoadoutsDir(cwd), "mine.toml"), "utf8");
    expect(contents).toContain('baseline = "team-default"');
  });
});
