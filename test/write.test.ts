import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidLoadoutName, loadoutFilePath, LoadoutAlreadyExistsError, writeNewLoadoutFile } from "../src/loadout/write.js";
import { globalLoadoutsDir, projectLoadoutsDir } from "../src/loadout/store.js";

describe("isValidLoadoutName", () => {
  it.each(["dev", "my-loadout", "my_loadout", "v1.2", "A9"])("accepts %s", (name) => {
    expect(isValidLoadoutName(name)).toBe(true);
  });

  it.each(["all", "none", "", "has space", "../escape", "has/slash"])("rejects %s", (name) => {
    expect(isValidLoadoutName(name)).toBe(false);
  });
});

describe("writeNewLoadoutFile", () => {
  let plugdinHome: string;
  let cwd: string;
  let originalPlugdinHome: string | undefined;

  beforeEach(async () => {
    plugdinHome = await mkdtemp(join(tmpdir(), "plugdin-home-"));
    cwd = await mkdtemp(join(tmpdir(), "plugdin-cwd-"));
    originalPlugdinHome = process.env.PLUGDIN_HOME;
    process.env.PLUGDIN_HOME = plugdinHome;
  });

  afterEach(async () => {
    if (originalPlugdinHome === undefined) delete process.env.PLUGDIN_HOME;
    else process.env.PLUGDIN_HOME = originalPlugdinHome;
    await rm(plugdinHome, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("writes a project-scoped Loadout with baseline, allow, and deny", async () => {
    const path = await writeNewLoadoutFile(
      { name: "dev", scope: "project", baseline: { kind: "none" }, allow: ["tdd@skills-dir"], deny: [] },
      cwd,
    );
    expect(path).toBe(join(projectLoadoutsDir(cwd), "dev.toml"));
    const contents = await readFile(path, "utf8");
    expect(contents).toContain('baseline = "none"');
    expect(contents).toContain("tdd@skills-dir");
  });

  it("writes a global-scoped Loadout under PLUGDIN_HOME", async () => {
    const path = await writeNewLoadoutFile({ name: "everyday", scope: "global", baseline: { kind: "all" }, allow: [], deny: [] }, cwd);
    expect(path).toBe(join(globalLoadoutsDir(), "everyday.toml"));
    const contents = await readFile(path, "utf8");
    expect(contents).toContain('baseline = "all"');
  });

  it("serializes a baseline that references another Loadout's name as a bare string", async () => {
    const path = await writeNewLoadoutFile(
      { name: "child", scope: "project", baseline: { kind: "loadout", name: "parent" }, allow: [], deny: [] },
      cwd,
    );
    const contents = await readFile(path, "utf8");
    expect(contents).toContain('baseline = "parent"');
  });

  it("omits allow/deny from the file entirely when empty, rather than writing []", async () => {
    const path = await writeNewLoadoutFile({ name: "minimal", scope: "project", baseline: { kind: "all" }, allow: [], deny: [] }, cwd);
    const contents = await readFile(path, "utf8");
    expect(contents).not.toContain("allow");
    expect(contents).not.toContain("deny");
  });

  it("refuses to overwrite an existing Loadout file", async () => {
    await writeNewLoadoutFile({ name: "dev", scope: "project", baseline: { kind: "all" }, allow: [], deny: [] }, cwd);
    await expect(
      writeNewLoadoutFile({ name: "dev", scope: "project", baseline: { kind: "none" }, allow: [], deny: [] }, cwd),
    ).rejects.toThrow(LoadoutAlreadyExistsError);
  });

  it("rejects an invalid name before touching the filesystem", async () => {
    await expect(
      writeNewLoadoutFile({ name: "all", scope: "project", baseline: { kind: "all" }, allow: [], deny: [] }, cwd),
    ).rejects.toThrow(/Invalid Loadout name/);
  });
});

describe("loadoutFilePath", () => {
  it("points at the project loadouts dir for project scope", () => {
    expect(loadoutFilePath({ name: "dev", scope: "project" }, "/repo")).toBe(join(projectLoadoutsDir("/repo"), "dev.toml"));
  });
});
