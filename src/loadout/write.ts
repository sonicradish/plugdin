import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stringify as stringifyToml } from "smol-toml";
import { globalLoadoutsDir, projectLoadoutsDir } from "./store.js";
import type { Baseline } from "../domain/types.js";

export class LoadoutAlreadyExistsError extends Error {
  constructor(path: string) {
    super(`A Loadout file already exists at ${path} — this won't overwrite it`);
  }
}

/** Filesystem-safe, and not one of the two built-in names that need no file. */
export function isValidLoadoutName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && name !== "all" && name !== "none";
}

function baselineToToml(baseline: Baseline): string {
  if (baseline.kind === "all") return "all";
  if (baseline.kind === "none") return "none";
  return baseline.name;
}

export interface NewLoadoutSpec {
  readonly name: string;
  readonly scope: "global" | "project";
  readonly baseline: Baseline;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export function loadoutFilePath(spec: Pick<NewLoadoutSpec, "name" | "scope">, cwd: string): string {
  const dir = spec.scope === "global" ? globalLoadoutsDir() : projectLoadoutsDir(cwd);
  return join(dir, `${spec.name}.toml`);
}

/**
 * Writes a new Loadout TOML file. Refuses to overwrite an existing one — editing an
 * existing Loadout is a manual text-edit (or `--undo`-style regeneration), not something
 * the creation wizard does silently.
 */
export async function writeNewLoadoutFile(spec: NewLoadoutSpec, cwd: string): Promise<string> {
  if (!isValidLoadoutName(spec.name)) {
    throw new Error(`Invalid Loadout name "${spec.name}": use letters, numbers, "-", "_", "." only; "all"/"none" are reserved`);
  }
  const path = loadoutFilePath(spec, cwd);
  if (existsSync(path)) throw new LoadoutAlreadyExistsError(path);

  const body: Record<string, unknown> = { baseline: baselineToToml(spec.baseline) };
  if (spec.allow.length > 0) body.allow = [...spec.allow];
  if (spec.deny.length > 0) body.deny = [...spec.deny];

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyToml(body) + "\n", "utf8");
  return path;
}
