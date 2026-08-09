import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoadoutConfigError } from "../domain/errors.js";
import { buildInventory, type DiscoveryWarning } from "../inventory/index.js";
import { findLoadout, loadLoadouts, resolveDefaultLoadoutName } from "../loadout/store.js";
import { explicitlySetKeys, resolveLoadout } from "../loadout/resolve.js";
import { gatherProjectionContext, projectAll } from "../projection/index.js";
import type { ClientId, Inventory, Projection, Resolution } from "../domain/types.js";

export class UnknownLoadoutError extends LoadoutConfigError {
  constructor(name: string) {
    super(`No Loadout named "${name}" (checked global and project .pluggedin/loadouts/, and the "all"/"none" built-ins)`);
  }
}

export interface ExplainResult {
  readonly loadoutName: string;
  readonly warnings: readonly DiscoveryWarning[];
  readonly inventory: Inventory;
  readonly resolution: Resolution;
  /** Component keys this Loadout (or a Loadout it inherits from) explicitly allow/deny'd —
   * everything else is just the chain's terminal all/none baseline showing through. */
  readonly explicitKeys: ReadonlySet<string>;
  readonly projections: Readonly<Record<ClientId, Projection>>;
}

/**
 * Resolves a Loadout against the live Inventory and computes what each Client's Projection
 * would be, without launching anything or writing to disk (PLAN.md Phase 1: "explain is a
 * v1 requirement, not a nicety"). `workDir` only appears in the returned Projection's
 * generated-file paths for display; nothing is written there.
 */
export async function explain(cwd: string, loadoutNameArg?: string, claudeHome?: string): Promise<ExplainResult> {
  const loadoutName = loadoutNameArg ?? (await resolveDefaultLoadoutName(cwd));
  const [{ inventory, warnings }, loadouts] = await Promise.all([
    buildInventory(cwd, claudeHome),
    loadLoadouts(cwd),
  ]);

  const loadout = findLoadout(loadoutName, loadouts);
  if (!loadout) throw new UnknownLoadoutError(loadoutName);

  const resolution = resolveLoadout(loadout, inventory, loadouts);
  const context = await gatherProjectionContext(join(tmpdir(), "pluggedin", "preview"));

  return {
    loadoutName,
    warnings,
    inventory,
    resolution,
    explicitKeys: explicitlySetKeys(loadout, loadouts),
    projections: projectAll(inventory, resolution, context),
  };
}
