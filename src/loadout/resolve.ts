import { LoadoutConfigError } from "../domain/errors.js";
import type { Component, Inventory, Loadout, Resolution } from "../domain/types.js";

export class UnknownBaselineLoadoutError extends LoadoutConfigError {
  constructor(name: string) {
    super(`Loadout baseline references unknown Loadout "${name}"`);
  }
}

export class BaselineCycleError extends LoadoutConfigError {
  constructor(chain: readonly string[]) {
    super(`Loadout baseline cycle: ${chain.join(" -> ")}`);
  }
}

export class AmbiguousAllowDenyError extends LoadoutConfigError {
  constructor(loadoutName: string, keys: readonly string[]) {
    super(`Loadout "${loadoutName}" lists the same Component in both allow and deny: ${keys.join(", ")}`);
  }
}

/**
 * Resolves a Loadout to an on/off decision for every Component in the Inventory. A
 * `baseline: all` Loadout picks up newly installed Components; `baseline: none` does not —
 * this falls out naturally from resolving against the live `inventory.components` list
 * rather than a snapshot (PLAN.md Phase 2).
 */
export function resolveLoadout(
  loadout: Loadout,
  inventory: Inventory,
  loadoutsByName: ReadonlyMap<string, Loadout>,
): Resolution {
  const overlap = loadout.allow.filter((k) => loadout.deny.includes(k));
  if (overlap.length > 0) throw new AmbiguousAllowDenyError(loadout.name, overlap);

  const baselineDecisions = resolveBaseline(loadout.baseline, inventory, loadoutsByName, [loadout.name]);

  const decisions = new Map(baselineDecisions);
  for (const key of loadout.allow) decisions.set(key, true);
  for (const key of loadout.deny) decisions.set(key, false);

  return { loadoutName: loadout.name, decisions };
}

function resolveBaseline(
  baseline: Loadout["baseline"],
  inventory: Inventory,
  loadoutsByName: ReadonlyMap<string, Loadout>,
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
  const parent = loadoutsByName.get(baseline.name);
  if (!parent) throw new UnknownBaselineLoadoutError(baseline.name);

  const parentBaseline = resolveBaseline(parent.baseline, inventory, loadoutsByName, [...chain, baseline.name]);
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
 * Component keys touched by an explicit `allow`/`deny` anywhere in a Loadout's baseline
 * chain (the Loadout itself or any Loadout it inherits from) — the keys whose final state
 * is a deliberate choice, as opposed to just falling through to the chain's terminal
 * `all`/`none` baseline untouched. Purely for display (`explain`); resolution itself doesn't
 * need this distinction. Walks the same chain `resolveBaseline` does, so a cycle here would
 * already have been caught by `resolveLoadout` before this is ever called.
 */
export function explicitlySetKeys(loadout: Loadout, loadoutsByName: ReadonlyMap<string, Loadout>): ReadonlySet<string> {
  const keys = new Set<string>();
  const visited = new Set<string>();
  let current: Loadout | undefined = loadout;
  while (current && !visited.has(current.name)) {
    visited.add(current.name);
    for (const key of current.allow) keys.add(key);
    for (const key of current.deny) keys.add(key);
    current = current.baseline.kind === "loadout" ? loadoutsByName.get(current.baseline.name) : undefined;
  }
  return keys;
}
