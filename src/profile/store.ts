import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { parse as parseToml } from "smol-toml";
import { ProfileConfigError } from "../domain/errors.js";
import type { Baseline, Profile } from "../domain/types.js";

export class InvalidProfileFileError extends ProfileConfigError {
  constructor(path: string, detail: string) {
    super(`Invalid Profile file ${path}: ${detail}`);
  }
}

/** `PLUGDIN_HOME` lets tests (and users who want the global store elsewhere) override this. */
export function plugdinHome(): string {
  return process.env.PLUGDIN_HOME ?? join(homedir(), ".plugdin");
}

export function globalProfilesDir(): string {
  return join(plugdinHome(), "profiles");
}

export function projectProfilesDir(cwd: string): string {
  return join(cwd, ".plugdin", "profiles");
}

function parseBaseline(raw: unknown, path: string): Baseline {
  if (raw === undefined || raw === "all") return { kind: "all" };
  if (raw === "none") return { kind: "none" };
  if (typeof raw === "string") return { kind: "profile", name: raw };
  throw new InvalidProfileFileError(path, `"baseline" must be "all", "none", or another Profile's name`);
}

function parseStringArray(raw: unknown, field: string, path: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    throw new InvalidProfileFileError(path, `"${field}" must be an array of strings`);
  }
  return raw;
}

async function loadProfileFile(path: string, scope: Profile["scope"]): Promise<Profile> {
  const contents = await readFile(path, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(contents);
  } catch (err) {
    throw new InvalidProfileFileError(path, (err as Error).message);
  }
  const name = basename(path, ".toml");
  return {
    name,
    baseline: parseBaseline(parsed.baseline, path),
    allow: parseStringArray(parsed.allow, "allow", path),
    deny: parseStringArray(parsed.deny, "deny", path),
    scope,
    definedAt: path,
  };
}

async function loadDir(dir: string, scope: Profile["scope"]): Promise<Profile[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const profiles: Profile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
    profiles.push(await loadProfileFile(join(dir, entry.name), scope));
  }
  return profiles;
}

/**
 * Project Profiles override global ones **by name, never merge** (PLAN.md Phase 2: "merged
 * allow/deny sets across scopes cannot be debugged") — a project `.toml` with the same
 * filename as a global one replaces it outright, it does not combine allow/deny lists.
 */
export async function loadProfiles(cwd: string): Promise<Map<string, Profile>> {
  const [global, project] = await Promise.all([
    loadDir(globalProfilesDir(), "global"),
    loadDir(projectProfilesDir(cwd), "project"),
  ]);
  const byName = new Map<string, Profile>();
  for (const l of global) byName.set(l.name, l);
  for (const l of project) byName.set(l.name, l); // project replaces global entirely, by name
  return byName;
}

interface ProjectConfig {
  readonly defaultProfile?: string;
}

/** A project may declare a default Profile (`.plugdin/config.toml`); it may never force one. */
export async function readProjectDefaultProfile(cwd: string): Promise<string | undefined> {
  const path = join(cwd, ".plugdin", "config.toml");
  if (!existsSync(path)) return undefined;
  const contents = await readFile(path, "utf8");
  const parsed = parseToml(contents) as { default_profile?: unknown };
  return typeof parsed.default_profile === "string" ? parsed.default_profile : undefined;
}

export const BASELINE_ALL: Profile = {
  name: "all",
  baseline: { kind: "all" },
  allow: [],
  deny: [],
  scope: "global",
  definedAt: "<built-in>",
};

export const BASELINE_NONE: Profile = {
  name: "none",
  baseline: { kind: "none" },
  allow: [],
  deny: [],
  scope: "global",
  definedAt: "<built-in>",
};

/**
 * Resolves which Profile a bare `plugdin run <client>` (no `--profile`) should use: the
 * project's declared default if it has one, else the built-in `all` baseline (PLAN.md
 * "Fail closed, but only when asked" — not using plugdin changes nothing, but choosing to
 * use it without naming a Profile should not silently hide everything either).
 */
export async function resolveDefaultProfileName(cwd: string): Promise<string> {
  return (await readProjectDefaultProfile(cwd)) ?? "all";
}

/** Looks up a Profile by name, including the two built-ins that don't need a file on disk. */
export function findProfile(name: string, byName: ReadonlyMap<string, Profile>): Profile | undefined {
  if (name === "all") return byName.get("all") ?? BASELINE_ALL;
  if (name === "none") return byName.get("none") ?? BASELINE_NONE;
  return byName.get(name);
}
