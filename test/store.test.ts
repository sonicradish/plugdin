import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoadoutConfigError } from "../src/domain/errors.js";
import {
  InvalidLoadoutFileError,
  findLoadout,
  globalLoadoutsDir,
  loadLoadouts,
  projectLoadoutsDir,
  readProjectDefaultLoadout,
  resolveDefaultLoadoutName,
} from "../src/loadout/store.js";

describe("InvalidLoadoutFileError", () => {
  it("is a LoadoutConfigError, so the CLI's generic catch handles it", () => {
    expect(new InvalidLoadoutFileError("x.toml", "detail")).toBeInstanceOf(LoadoutConfigError);
  });
});

describe("loadLoadouts", () => {
  let pluggedInHome: string;
  let cwd: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    pluggedInHome = await mkdtemp(join(tmpdir(), "pluggedin-home-"));
    cwd = await mkdtemp(join(tmpdir(), "pluggedin-project-"));
    originalHome = process.env.PLUGGEDIN_HOME;
    process.env.PLUGGEDIN_HOME = pluggedInHome;
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.PLUGGEDIN_HOME;
    else process.env.PLUGGEDIN_HOME = originalHome;
    await rm(pluggedInHome, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns an empty map when neither scope has any Loadout files", async () => {
    expect(await loadLoadouts(cwd)).toEqual(new Map());
  });

  it("loads a global Loadout", async () => {
    await mkdir(globalLoadoutsDir(), { recursive: true });
    await writeFile(join(globalLoadoutsDir(), "everyday.toml"), `baseline = "none"\nallow = ["tdd@skills-dir"]\n`);

    const loadouts = await loadLoadouts(cwd);
    expect(loadouts.get("everyday")).toMatchObject({
      name: "everyday",
      baseline: { kind: "none" },
      allow: ["tdd@skills-dir"],
      scope: "global",
    });
  });

  it("a project Loadout of the same name REPLACES the global one entirely, not merges", async () => {
    await mkdir(globalLoadoutsDir(), { recursive: true });
    await writeFile(join(globalLoadoutsDir(), "everyday.toml"), `baseline = "none"\nallow = ["global-only@x"]\n`);
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "everyday.toml"), `baseline = "all"\ndeny = ["project-only@x"]\n`);

    const loadouts = await loadLoadouts(cwd);
    const resolved = loadouts.get("everyday");
    expect(resolved?.scope).toBe("project");
    expect(resolved?.baseline).toEqual({ kind: "all" });
    expect(resolved?.allow).toEqual([]); // NOT merged with the global file's allow
    expect(resolved?.deny).toEqual(["project-only@x"]);
  });

  it("defaults baseline to all when omitted", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "no-baseline.toml"), `allow = ["x"]\n`);
    const loadouts = await loadLoadouts(cwd);
    expect(loadouts.get("no-baseline")?.baseline).toEqual({ kind: "all" });
  });

  it("treats a bare string baseline as a reference to another Loadout's name", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "child.toml"), `baseline = "parent"\n`);
    const loadouts = await loadLoadouts(cwd);
    expect(loadouts.get("child")?.baseline).toEqual({ kind: "loadout", name: "parent" });
  });

  it("throws InvalidLoadoutFileError for malformed TOML", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "broken.toml"), `this is not valid toml =====`);
    await expect(loadLoadouts(cwd)).rejects.toThrow(InvalidLoadoutFileError);
  });

  it("throws InvalidLoadoutFileError when allow is not an array of strings", async () => {
    await mkdir(projectLoadoutsDir(cwd), { recursive: true });
    await writeFile(join(projectLoadoutsDir(cwd), "bad-allow.toml"), `allow = "not-an-array"\n`);
    await expect(loadLoadouts(cwd)).rejects.toThrow(InvalidLoadoutFileError);
  });
});

describe("readProjectDefaultLoadout / resolveDefaultLoadoutName", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "pluggedin-project-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("returns undefined, and defaults to 'all', when the project declares no default", async () => {
    expect(await readProjectDefaultLoadout(cwd)).toBeUndefined();
    expect(await resolveDefaultLoadoutName(cwd)).toBe("all");
  });

  it("reads a declared default_loadout from .pluggedin/config.toml", async () => {
    await mkdir(join(cwd, ".pluggedin"), { recursive: true });
    await writeFile(join(cwd, ".pluggedin", "config.toml"), `default_loadout = "everyday"\n`);
    expect(await readProjectDefaultLoadout(cwd)).toBe("everyday");
    expect(await resolveDefaultLoadoutName(cwd)).toBe("everyday");
  });
});

describe("findLoadout", () => {
  it("returns built-in all/none Loadouts even when the map is empty", () => {
    expect(findLoadout("all", new Map())?.baseline).toEqual({ kind: "all" });
    expect(findLoadout("none", new Map())?.baseline).toEqual({ kind: "none" });
  });

  it("returns undefined for a name that isn't a built-in and isn't in the map", () => {
    expect(findLoadout("nope", new Map())).toBeUndefined();
  });
});
