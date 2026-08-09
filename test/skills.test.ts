import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverLooseSkills, isAnnotated, parseSkillFrontmatter, skillToComponent } from "../src/inventory/skills.js";

describe("parseSkillFrontmatter", () => {
  it("reads name and description from --- delimited frontmatter", () => {
    const contents = `---\nname: tdd\ndescription: Test-driven development.\n---\n\n# Body\n`;
    expect(parseSkillFrontmatter(contents)).toEqual({ name: "tdd", description: "Test-driven development." });
  });

  it("strips surrounding quotes from quoted values", () => {
    const contents = `---\nname: implement\ndescription: "Implement a piece of work."\n---\n`;
    expect(parseSkillFrontmatter(contents)).toEqual({ name: "implement", description: "Implement a piece of work." });
  });

  it("returns undefined when there is no frontmatter block", () => {
    expect(parseSkillFrontmatter("# Just a heading\n")).toBeUndefined();
  });

  it("returns undefined when required fields are missing", () => {
    const contents = `---\nname: no-description\n---\n`;
    expect(parseSkillFrontmatter(contents)).toBeUndefined();
  });

  it("ignores extra frontmatter fields like disable-model-invocation", () => {
    const contents = `---\nname: ask-matt\ndescription: Router.\ndisable-model-invocation: true\n---\n`;
    expect(parseSkillFrontmatter(contents)).toEqual({ name: "ask-matt", description: "Router." });
  });
});

describe("discoverLooseSkills + isAnnotated", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "pluggedin-skills-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("finds skill directories containing a valid SKILL.md", async () => {
    const skillDir = join(root, "my-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: my-skill\ndescription: Does a thing.\n---\n`);

    const skills = await discoverLooseSkills(root);
    expect(skills).toEqual([{ name: "my-skill", description: "Does a thing.", dir: skillDir, annotated: false }]);
  });

  it("skips directories without SKILL.md", async () => {
    await mkdir(join(root, "not-a-skill"), { recursive: true });
    expect(await discoverLooseSkills(root)).toEqual([]);
  });

  it("marks a skill annotated once .claude-plugin/plugin.json exists beside it", async () => {
    const skillDir = join(root, "annotated-skill");
    await mkdir(join(skillDir, ".claude-plugin"), { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), `---\nname: annotated-skill\ndescription: d\n---\n`);
    await writeFile(join(skillDir, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "annotated-skill" }));

    expect(isAnnotated(skillDir)).toBe(true);
    const [skill] = await discoverLooseSkills(root);
    expect(skill?.annotated).toBe(true);
  });

  it("returns an empty list for a root that does not exist", async () => {
    expect(await discoverLooseSkills(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("skillToComponent", () => {
  it("keys skills as name@skills-dir, matching ADR-0003's Annotation naming", () => {
    const component = skillToComponent(
      { name: "tdd", description: "Test-driven development.", dir: "/skills/tdd", annotated: true },
      ["claude-code", "codex"],
    );
    expect(component).toEqual({
      id: { kind: "skill", key: "tdd@skills-dir" },
      name: "tdd",
      description: "Test-driven development.",
      clients: ["claude-code", "codex"],
      sourcePath: "/skills/tdd",
      annotation: "annotated",
    });
  });
});
