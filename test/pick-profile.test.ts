import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakePrompter } from "./support/fake-prompter.js";
import { writeAnnotation } from "../src/adopt/annotate.js";
import { projectProfilesDir } from "../src/profile/store.js";

const { runClientCommand } = vi.hoisted(() => ({ runClientCommand: vi.fn() }));
vi.mock("../src/util/exec.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/util/exec.js")>();
  // Both entry points share one implementation: which of the two an adapter uses is an
  // internal detail (large outputs bypass the pipe), not something a test should have to know.
  return { ...actual, runClientCommand, runClientCommandToFile: runClientCommand };
});

const { pickOrCreateProfile } = await import("../src/commands/pick-profile.js");

describe("pickOrCreateProfile", () => {
  let cwd: string;
  let claudeHome: string;
  let plugdinHome: string;
  let originalPlugdinHome: string | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "plugdin-cwd-"));
    claudeHome = await mkdtemp(join(tmpdir(), "plugdin-claude-home-"));
    plugdinHome = await mkdtemp(join(tmpdir(), "plugdin-home-"));
    originalPlugdinHome = process.env.PLUGDIN_HOME;
    process.env.PLUGDIN_HOME = plugdinHome;
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

  async function makeSkill(name: string) {
    const dir = join(claudeHome, "skills", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
  }

  it("offers all/none built-ins and Create..., and returns 'all' when chosen", async () => {
    const prompter = new FakePrompter().queueSelect("__plugdin_all__");
    const result = await pickOrCreateProfile(cwd, prompter, claudeHome);
    expect(result).toEqual({ profileName: "all", created: false });
    expect(prompter.selectPrompts[0]?.options.map((o) => o.value)).toEqual([
      "__plugdin_all__",
      "__plugdin_none__",
      "__plugdin_create__",
    ]);
  });

  it("returns 'none' when chosen", async () => {
    const prompter = new FakePrompter().queueSelect("__plugdin_none__");
    const result = await pickOrCreateProfile(cwd, prompter, claudeHome);
    expect(result).toEqual({ profileName: "none", created: false });
  });

  it("lists an existing project Profile as a pickable option and returns it directly", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "dev.toml"), `baseline = "none"\n`);

    const prompter = new FakePrompter().queueSelect("dev");
    const result = await pickOrCreateProfile(cwd, prompter, claudeHome);
    expect(result).toEqual({ profileName: "dev", created: false });
    expect(prompter.selectPrompts[0]?.options[0]).toEqual({ value: "dev", label: "dev (project)" });
  });

  it("creates a new project Profile with baseline none and hand-picked allow list", async () => {
    await makeSkill("tdd");
    await makeSkill("grilling");

    const prompter = new FakePrompter()
      .queueSelect("__plugdin_create__") // top-level menu
      .queueInput("my-profile") // name
      .queueSelect("project") // scope
      .queueSelect("none") // baseline
      .queueToggleResult(new Set(["tdd@skills-dir"])); // turn tdd on, leave grilling off

    const result = await pickOrCreateProfile(cwd, prompter, claudeHome);
    expect(result.created).toBe(true);
    expect(result.profileName).toBe("my-profile");

    const contents = await readFile(join(projectProfilesDir(cwd), "my-profile.toml"), "utf8");
    expect(contents).toContain('baseline = "none"');
    expect(contents).toContain("tdd@skills-dir");
    expect(contents).not.toContain("grilling@skills-dir");
  });

  it("creates a Profile with baseline all, computing deny from what got turned off", async () => {
    await makeSkill("tdd");
    await makeSkill("grilling");

    const prompter = new FakePrompter()
      .queueSelect("__plugdin_create__")
      .queueInput("minus-grilling")
      .queueSelect("project")
      .queueSelect("all")
      .queueToggleResult(new Set(["tdd@skills-dir"])); // grilling started on (baseline all), now off

    await pickOrCreateProfile(cwd, prompter, claudeHome);
    const contents = await readFile(join(projectProfilesDir(cwd), "minus-grilling.toml"), "utf8");
    expect(contents).toContain('baseline = "all"');
    expect(contents).toContain("grilling@skills-dir"); // in deny
    expect(contents).not.toMatch(/allow/); // nothing was turned ON beyond the all baseline
  });

  it("re-prompts for a name when the first one is invalid or already taken", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "taken.toml"), `baseline = "all"\n`);

    const prompter = new FakePrompter()
      .queueSelect("__plugdin_create__")
      .queueInput("all", "taken", "fresh-name") // "all" is reserved, "taken" already exists
      .queueSelect("project")
      .queueSelect("none");

    const result = await pickOrCreateProfile(cwd, prompter, claudeHome);
    expect(result.profileName).toBe("fresh-name");
    expect(prompter.notes.some((n) => n.includes("Invalid name"))).toBe(true);
    expect(prompter.notes.some((n) => n.includes("already exists"))).toBe(true);
  });

  it("flags an existing Profile in the menu when it would produce a refusal", async () => {
    await makeSkill("tdd"); // unannotated — turning it off is a refusal (ADR-0001)
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "off.toml"), `baseline = "none"\n`);

    const prompter = new FakePrompter().queueSelect("__plugdin_none__");
    await pickOrCreateProfile(cwd, prompter, claudeHome);
    const option = prompter.selectPrompts[0]?.options.find((o) => o.value === "off");
    expect(option?.label).toContain("⚠ 1 refusal");
  });

  it("labels an unannotated skill's toggle item with a Claude Code caveat", async () => {
    await makeSkill("tdd");

    const prompter = new FakePrompter().queueSelect("__plugdin_create__").queueInput("x").queueSelect("project").queueSelect("none");
    await pickOrCreateProfile(cwd, prompter, claudeHome);

    const item = prompter.toggleListPrompts[0]?.items.find((i) => i.key === "tdd@skills-dir");
    expect(item?.label).toContain("⚠ Claude Code: off needs `adopt` first");
  });

  it("does not caveat an annotated skill's toggle item", async () => {
    const dir = join(claudeHome, "skills", "tdd");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "SKILL.md"), `---\nname: tdd\ndescription: d\n---\n`);
    await writeAnnotation(dir, "tdd", "d");

    const prompter = new FakePrompter().queueSelect("__plugdin_create__").queueInput("x").queueSelect("project").queueSelect("none");
    await pickOrCreateProfile(cwd, prompter, claudeHome);

    const item = prompter.toggleListPrompts[0]?.items.find((i) => i.key === "tdd@skills-dir");
    expect(item?.label).not.toContain("⚠");
  });

  it("labels an already-configured Codex MCP server's toggle item with a Codex caveat", async () => {
    runClientCommand.mockImplementation(async (bin: string, args: readonly string[]) => {
      if (bin === "claude") return { available: true, stdout: "[]", stderr: "" };
      if (bin === "codex" && args.join(" ") === "plugin list --json") return { available: true, stdout: JSON.stringify({ installed: [] }), stderr: "" };
      if (bin === "codex" && args.join(" ") === "mcp list --json") {
        return {
          available: true,
          stdout: JSON.stringify([{ name: "node_repl", transport: { type: "stdio", command: "/bin/node_repl", args: [], env: {} } }]),
          stderr: "",
        };
      }
      return { available: true, stdout: "[]", stderr: "" };
    });

    const prompter = new FakePrompter().queueSelect("__plugdin_create__").queueInput("x").queueSelect("project").queueSelect("none");
    await pickOrCreateProfile(cwd, prompter, claudeHome);

    const item = prompter.toggleListPrompts[0]?.items.find((i) => i.label.includes("node_repl"));
    expect(item?.label).toContain("⚠ Codex: can't be turned off, stays on regardless");
  });

  it("does not flag an existing Profile in the menu when it resolves cleanly", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "clean.toml"), `baseline = "none"\n`);

    const prompter = new FakePrompter().queueSelect("__plugdin_none__");
    await pickOrCreateProfile(cwd, prompter, claudeHome);
    const option = prompter.selectPrompts[0]?.options.find((o) => o.value === "clean");
    expect(option?.label).toBe("clean (project)");
  });

  it("flags an existing Profile with an invalid config (e.g. a dangling baseline reference) instead of crashing the picker", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "broken.toml"), `baseline = "does-not-exist"\n`);

    const prompter = new FakePrompter().queueSelect("__plugdin_none__");
    const result = await pickOrCreateProfile(cwd, prompter, claudeHome);
    expect(result).toEqual({ profileName: "none", created: false }); // picking a different option still works
    const option = prompter.selectPrompts[0]?.options.find((o) => o.value === "broken");
    expect(option?.label).toContain("⚠ invalid config");
  });

  it("offers existing Profiles as baseline choices when creating a new one", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "team-default.toml"), `baseline = "none"\nallow = ["tdd@skills-dir"]\n`);
    await makeSkill("tdd");

    const prompter = new FakePrompter()
      .queueSelect("__plugdin_create__")
      .queueInput("mine")
      .queueSelect("project")
      .queueSelect("team-default");

    await pickOrCreateProfile(cwd, prompter, claudeHome);
    const baselinePrompt = prompter.selectPrompts.find((p) => p.message === "Baseline");
    expect(baselinePrompt?.options.map((o) => o.value)).toContain("team-default");

    const contents = await readFile(join(projectProfilesDir(cwd), "mine.toml"), "utf8");
    expect(contents).toContain('baseline = "team-default"');
  });
});
