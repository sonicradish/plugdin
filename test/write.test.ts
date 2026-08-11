import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidProfileName, profileFilePath, ProfileAlreadyExistsError, writeNewProfileFile } from "../src/profile/write.js";
import { globalProfilesDir, projectProfilesDir } from "../src/profile/store.js";

describe("isValidProfileName", () => {
  it.each(["dev", "my-profile", "my_profile", "v1.2", "A9"])("accepts %s", (name) => {
    expect(isValidProfileName(name)).toBe(true);
  });

  it.each(["all", "none", "", "has space", "../escape", "has/slash"])("rejects %s", (name) => {
    expect(isValidProfileName(name)).toBe(false);
  });
});

describe("writeNewProfileFile", () => {
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

  it("writes a project-scoped Profile with baseline, allow, and deny", async () => {
    const path = await writeNewProfileFile(
      { name: "dev", scope: "project", baseline: { kind: "none" }, allow: ["tdd@skills-dir"], deny: [] },
      cwd,
    );
    expect(path).toBe(join(projectProfilesDir(cwd), "dev.toml"));
    const contents = await readFile(path, "utf8");
    expect(contents).toContain('baseline = "none"');
    expect(contents).toContain("tdd@skills-dir");
  });

  it("writes a global-scoped Profile under PLUGDIN_HOME", async () => {
    const path = await writeNewProfileFile({ name: "everyday", scope: "global", baseline: { kind: "all" }, allow: [], deny: [] }, cwd);
    expect(path).toBe(join(globalProfilesDir(), "everyday.toml"));
    const contents = await readFile(path, "utf8");
    expect(contents).toContain('baseline = "all"');
  });

  it("serializes a baseline that references another Profile's name as a bare string", async () => {
    const path = await writeNewProfileFile(
      { name: "child", scope: "project", baseline: { kind: "profile", name: "parent" }, allow: [], deny: [] },
      cwd,
    );
    const contents = await readFile(path, "utf8");
    expect(contents).toContain('baseline = "parent"');
  });

  it("omits allow/deny from the file entirely when empty, rather than writing []", async () => {
    const path = await writeNewProfileFile({ name: "minimal", scope: "project", baseline: { kind: "all" }, allow: [], deny: [] }, cwd);
    const contents = await readFile(path, "utf8");
    expect(contents).not.toContain("allow");
    expect(contents).not.toContain("deny");
  });

  it("refuses to overwrite an existing Profile file", async () => {
    await writeNewProfileFile({ name: "dev", scope: "project", baseline: { kind: "all" }, allow: [], deny: [] }, cwd);
    await expect(
      writeNewProfileFile({ name: "dev", scope: "project", baseline: { kind: "none" }, allow: [], deny: [] }, cwd),
    ).rejects.toThrow(ProfileAlreadyExistsError);
  });

  it("rejects an invalid name before touching the filesystem", async () => {
    await expect(
      writeNewProfileFile({ name: "all", scope: "project", baseline: { kind: "all" }, allow: [], deny: [] }, cwd),
    ).rejects.toThrow(/Invalid Profile name/);
  });
});

describe("profileFilePath", () => {
  it("points at the project profiles dir for project scope", () => {
    expect(profileFilePath({ name: "dev", scope: "project" }, "/repo")).toBe(join(projectProfilesDir("/repo"), "dev.toml"));
  });
});
