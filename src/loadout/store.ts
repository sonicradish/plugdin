import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { parse as parseToml } from "smol-toml";
import { LoadoutConfigError } from "../domain/errors.js";
import type { Baseline, Loadout } from "../domain/types.js";

export class InvalidLoadoutFileError extends LoadoutConfigError {
  constructor(path: string, detail: string) {
    super(`Invalid Loadout file ${path}: ${detail}`);
  }
}

/** `PLUGGED_IN_HOME` lets tests (and users who want the global store elsewhere) override this. */
export function pluggedInHome(): string {
  return process.env.PLUGGED_IN_HOME ?? join(homedir(), ".plugged-in");
}

export function globalLoadoutsDir(): string {
  return join(pluggedInHome(), "loadouts");
}

export function projectLoadoutsDir(cwd: string): string {
  return join(cwd, ".plugged-in", "loadouts");
}

function parseBaseline(raw: unknown, path: string): Baseline {
  if (raw === undefined || raw === "all") return { kind: "all" };
  if (raw === "none") return { kind: "none" };
  if (typeof raw === "string") return { kind: "loadout", name: raw };
  throw new InvalidLoadoutFileError(path, `"baseline" must be "all", "none", or another Loadout's name`);
}

function parseStringArray(raw: unknown, field: string, path: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    throw new InvalidLoadoutFileError(path, `"${field}" must be an array of strings`);
  }
  return raw;
}

async function loadLoadoutFile(path: string, scope: Loadout["scope"]): Promise<Loadout> {
  const contents = await readFile(path, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = parseToml(contents);
  } catch (err) {
    throw new InvalidLoadoutFileError(path, (err as Error).message);
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

async function loadDir(dir: string, scope: Loadout["scope"]): Promise<Loadout[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const loadouts: Loadout[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".toml")) continue;
    loadouts.push(await loadLoadoutFile(join(dir, entry.name), scope));
  }
  return loadouts;
}

/**
 * Project Loadouts override global ones **by name, never merge** (PLAN.md Phase 2: "merged
 * allow/deny sets across scopes cannot be debugged") — a project `.toml` with the same
 * filename as a global one replaces it outright, it does not combine allow/deny lists.
 */
export async function loadLoadouts(cwd: string): Promise<Map<string, Loadout>> {
  const [global, project] = await Promise.all([
    loadDir(globalLoadoutsDir(), "global"),
    loadDir(projectLoadoutsDir(cwd), "project"),
  ]);
  const byName = new Map<string, Loadout>();
  for (const l of global) byName.set(l.name, l);
  for (const l of project) byName.set(l.name, l); // project replaces global entirely, by name
  return byName;
}

interface ProjectConfig {
  readonly defaultLoadout?: string;
}

/** A project may declare a default Loadout (`.plugged-in/config.toml`); it may never force one. */
export async function readProjectDefaultLoadout(cwd: string): Promise<string | undefined> {
  const path = join(cwd, ".plugged-in", "config.toml");
  if (!existsSync(path)) return undefined;
  const contents = await readFile(path, "utf8");
  const parsed = parseToml(contents) as { default_loadout?: unknown };
  return typeof parsed.default_loadout === "string" ? parsed.default_loadout : undefined;
}

export const BASELINE_ALL: Loadout = {
  name: "all",
  baseline: { kind: "all" },
  allow: [],
  deny: [],
  scope: "global",
  definedAt: "<built-in>",
};

export const BASELINE_NONE: Loadout = {
  name: "none",
  baseline: { kind: "none" },
  allow: [],
  deny: [],
  scope: "global",
  definedAt: "<built-in>",
};

/**
 * Resolves which Loadout a bare `plugged-in run <client>` (no `--loadout`) should use: the
 * project's declared default if it has one, else the built-in `all` baseline (PLAN.md
 * "Fail closed, but only when asked" — not using plugged-in changes nothing, but choosing to
 * use it without naming a Loadout should not silently hide everything either).
 */
export async function resolveDefaultLoadoutName(cwd: string): Promise<string> {
  return (await readProjectDefaultLoadout(cwd)) ?? "all";
}

/** Looks up a Loadout by name, including the two built-ins that don't need a file on disk. */
export function findLoadout(name: string, byName: ReadonlyMap<string, Loadout>): Loadout | undefined {
  if (name === "all") return byName.get("all") ?? BASELINE_ALL;
  if (name === "none") return byName.get("none") ?? BASELINE_NONE;
  return byName.get(name);
}
