import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileConfigError } from "../src/domain/errors.js";
import {
  InvalidProfileFileError,
  findProfile,
  globalProfilesDir,
  loadProfiles,
  projectProfilesDir,
  readProjectDefaultProfile,
  resolveDefaultProfileName,
} from "../src/profile/store.js";

describe("InvalidProfileFileError", () => {
  it("is a ProfileConfigError, so the CLI's generic catch handles it", () => {
    expect(new InvalidProfileFileError("x.toml", "detail")).toBeInstanceOf(ProfileConfigError);
  });
});

describe("loadProfiles", () => {
  let plugdinHome: string;
  let cwd: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    plugdinHome = await mkdtemp(join(tmpdir(), "plugdin-home-"));
    cwd = await mkdtemp(join(tmpdir(), "plugdin-project-"));
    originalHome = process.env.PLUGDIN_HOME;
    process.env.PLUGDIN_HOME = plugdinHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.PLUGDIN_HOME;
    else process.env.PLUGDIN_HOME = originalHome;
    await rm(plugdinHome, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns an empty map when neither scope has any Profile files", async () => {
    expect(await loadProfiles(cwd)).toEqual(new Map());
  });

  it("loads a global Profile", async () => {
    await mkdir(globalProfilesDir(), { recursive: true });
    await writeFile(join(globalProfilesDir(), "everyday.toml"), `baseline = "none"\nallow = ["tdd@skills-dir"]\n`);

    const profiles = await loadProfiles(cwd);
    expect(profiles.get("everyday")).toMatchObject({
      name: "everyday",
      baseline: { kind: "none" },
      allow: ["tdd@skills-dir"],
      scope: "global",
    });
  });

  it("a project Profile of the same name REPLACES the global one entirely, not merges", async () => {
    await mkdir(globalProfilesDir(), { recursive: true });
    await writeFile(join(globalProfilesDir(), "everyday.toml"), `baseline = "none"\nallow = ["global-only@x"]\n`);
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "everyday.toml"), `baseline = "all"\ndeny = ["project-only@x"]\n`);

    const profiles = await loadProfiles(cwd);
    const resolved = profiles.get("everyday");
    expect(resolved?.scope).toBe("project");
    expect(resolved?.baseline).toEqual({ kind: "all" });
    expect(resolved?.allow).toEqual([]); // NOT merged with the global file's allow
    expect(resolved?.deny).toEqual(["project-only@x"]);
  });

  it("defaults baseline to all when omitted", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "no-baseline.toml"), `allow = ["x"]\n`);
    const profiles = await loadProfiles(cwd);
    expect(profiles.get("no-baseline")?.baseline).toEqual({ kind: "all" });
  });

  it("treats a bare string baseline as a reference to another Profile's name", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "child.toml"), `baseline = "parent"\n`);
    const profiles = await loadProfiles(cwd);
    expect(profiles.get("child")?.baseline).toEqual({ kind: "profile", name: "parent" });
  });

  it("throws InvalidProfileFileError for malformed TOML", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "broken.toml"), `this is not valid toml =====`);
    await expect(loadProfiles(cwd)).rejects.toThrow(InvalidProfileFileError);
  });

  it("throws InvalidProfileFileError when allow is not an array of strings", async () => {
    await mkdir(projectProfilesDir(cwd), { recursive: true });
    await writeFile(join(projectProfilesDir(cwd), "bad-allow.toml"), `allow = "not-an-array"\n`);
    await expect(loadProfiles(cwd)).rejects.toThrow(InvalidProfileFileError);
  });
});

describe("readProjectDefaultProfile / resolveDefaultProfileName", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "plugdin-project-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns undefined, and defaults to 'all', when the project declares no default", async () => {
    expect(await readProjectDefaultProfile(cwd)).toBeUndefined();
    expect(await resolveDefaultProfileName(cwd)).toBe("all");
  });

  it("reads a declared default_profile from .plugdin/config.toml", async () => {
    await mkdir(join(cwd, ".plugdin"), { recursive: true });
    await writeFile(join(cwd, ".plugdin", "config.toml"), `default_profile = "everyday"\n`);
    expect(await readProjectDefaultProfile(cwd)).toBe("everyday");
    expect(await resolveDefaultProfileName(cwd)).toBe("everyday");
  });
});

describe("findProfile", () => {
  it("returns built-in all/none Profiles even when the map is empty", () => {
    expect(findProfile("all", new Map())?.baseline).toEqual({ kind: "all" });
    expect(findProfile("none", new Map())?.baseline).toEqual({ kind: "none" });
  });

  it("returns undefined for a name that isn't a built-in and isn't in the map", () => {
    expect(findProfile("nope", new Map())).toBeUndefined();
  });
});
