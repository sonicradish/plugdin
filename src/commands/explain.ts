import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProfileConfigError } from "../domain/errors.js";
import { buildInventory, type DiscoveryWarning } from "../inventory/index.js";
import { findProfile, loadProfiles, resolveDefaultProfileName } from "../profile/store.js";
import { explicitlySetKeys, resolveProfile } from "../profile/resolve.js";
import { gatherProjectionContext, projectAll } from "../projection/index.js";
import type { ClientId, Inventory, Projection, Resolution } from "../domain/types.js";

export class UnknownProfileError extends ProfileConfigError {
  constructor(name: string) {
    super(`No Profile named "${name}" (checked global and project .plugdin/profiles/, and the "all"/"none" built-ins)`);
  }
}

export interface ExplainResult {
  readonly profileName: string;
  readonly warnings: readonly DiscoveryWarning[];
  readonly inventory: Inventory;
  readonly resolution: Resolution;
  /** Component keys this Profile (or a Profile it inherits from) explicitly allow/deny'd —
   * everything else is just the chain's terminal all/none baseline showing through. */
  readonly explicitKeys: ReadonlySet<string>;
  readonly projections: Readonly<Record<ClientId, Projection>>;
}

/**
 * Resolves a Profile against the live Inventory and computes what each Client's Projection
 * would be, without launching anything or writing to disk (PLAN.md Phase 1: "explain is a
 * v1 requirement, not a nicety"). `workDir` only appears in the returned Projection's
 * generated-file paths for display; nothing is written there.
 */
export async function explain(cwd: string, profileNameArg?: string, claudeHome?: string): Promise<ExplainResult> {
  const profileName = profileNameArg ?? (await resolveDefaultProfileName(cwd));
  const [{ inventory, warnings }, profiles] = await Promise.all([
    buildInventory(cwd, claudeHome),
    loadProfiles(cwd),
  ]);

  const profile = findProfile(profileName, profiles);
  if (!profile) throw new UnknownProfileError(profileName);

  const resolution = resolveProfile(profile, inventory, profiles);
  const context = await gatherProjectionContext(join(tmpdir(), "plugdin", "preview"));

  return {
    profileName,
    warnings,
    inventory,
    resolution,
    explicitKeys: explicitlySetKeys(profile, profiles),
    projections: projectAll(inventory, resolution, context),
  };
}
