import { ProfileConfigError } from "../domain/errors.js";
import type { Component, Inventory, Profile, Resolution } from "../domain/types.js";

export class UnknownBaselineProfileError extends ProfileConfigError {
  constructor(name: string) {
    super(`Profile baseline references unknown Profile "${name}"`);
  }
}

export class BaselineCycleError extends ProfileConfigError {
  constructor(chain: readonly string[]) {
    super(`Profile baseline cycle: ${chain.join(" -> ")}`);
  }
}

export class AmbiguousAllowDenyError extends ProfileConfigError {
  constructor(profileName: string, keys: readonly string[]) {
    super(`Profile "${profileName}" lists the same Component in both allow and deny: ${keys.join(", ")}`);
  }
}

/**
 * Resolves a Profile to an on/off decision for every Component in the Inventory. A
 * `baseline: all` Profile picks up newly installed Components; `baseline: none` does not —
 * this falls out naturally from resolving against the live `inventory.components` list
 * rather than a snapshot (PLAN.md Phase 2).
 */
export function resolveProfile(
  profile: Profile,
  inventory: Inventory,
  profilesByName: ReadonlyMap<string, Profile>,
): Resolution {
  const overlap = profile.allow.filter((k) => profile.deny.includes(k));
  if (overlap.length > 0) throw new AmbiguousAllowDenyError(profile.name, overlap);

  const baselineDecisions = resolveBaseline(profile.baseline, inventory, profilesByName, [profile.name]);

  const decisions = new Map(baselineDecisions);
  for (const key of profile.allow) decisions.set(key, true);
  for (const key of profile.deny) decisions.set(key, false);

  return { profileName: profile.name, decisions };
}

function resolveBaseline(
  baseline: Profile["baseline"],
  inventory: Inventory,
  profilesByName: ReadonlyMap<string, Profile>,
  chain: readonly string[],
): ReadonlyMap<string, boolean> {
  if (baseline.kind === "all") {
    return new Map(inventory.components.map((c) => [c.id.key, true]));
  }
  if (baseline.kind === "none") {
    return new Map(inventory.components.map((c) => [c.id.key, false]));
  }

  if (chain.includes(baseline.name)) {
    throw new BaselineCycleError([...chain, baseline.name]);
  }
  const parent = profilesByName.get(baseline.name);
  if (!parent) throw new UnknownBaselineProfileError(baseline.name);

  const parentBaseline = resolveBaseline(parent.baseline, inventory, profilesByName, [...chain, baseline.name]);
  const decisions = new Map(parentBaseline);
  for (const key of parent.allow) decisions.set(key, true);
  for (const key of parent.deny) decisions.set(key, false);
  return decisions;
}

/** Components a Resolution turns on, in Inventory order. */
export function activeComponents(resolution: Resolution, inventory: Inventory): Component[] {
  return inventory.components.filter((c) => resolution.decisions.get(c.id.key) === true);
}

/**
 * Component keys touched by an explicit `allow`/`deny` anywhere in a Profile's baseline
 * chain (the Profile itself or any Profile it inherits from) — the keys whose final state
 * is a deliberate choice, as opposed to just falling through to the chain's terminal
 * `all`/`none` baseline untouched. Purely for display (`explain`); resolution itself doesn't
 * need this distinction. Walks the same chain `resolveBaseline` does, so a cycle here would
 * already have been caught by `resolveProfile` before this is ever called.
 */
export function explicitlySetKeys(profile: Profile, profilesByName: ReadonlyMap<string, Profile>): ReadonlySet<string> {
  const keys = new Set<string>();
  const visited = new Set<string>();
  let current: Profile | undefined = profile;
  while (current && !visited.has(current.name)) {
    visited.add(current.name);
    for (const key of current.allow) keys.add(key);
    for (const key of current.deny) keys.add(key);
    current = current.baseline.kind === "profile" ? profilesByName.get(current.baseline.name) : undefined;
  }
  return keys;
}
