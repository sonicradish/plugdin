import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildInventory, type DiscoveryWarning } from "../inventory/index.js";
import { findLoadout, loadLoadouts, resolveDefaultLoadoutName } from "../loadout/store.js";
import { resolveLoadout } from "../loadout/resolve.js";
import { projectClaudeCode } from "../projection/claude-code.js";
import { projectCodex } from "../projection/codex.js";
import type { Activation, Inventory, Projection, Resolution } from "../domain/types.js";

export class UnknownLoadoutError extends Error {
  constructor(name: string) {
    super(`No Loadout named "${name}" (checked global and project .plugged-in/loadouts/, and the "all"/"none" built-ins)`);
  }
}

export interface ExplainResult {
  readonly loadoutName: string;
  readonly warnings: readonly DiscoveryWarning[];
  readonly inventory: Inventory;
  readonly resolution: Resolution;
  readonly projections: {
    readonly "claude-code": Projection;
    readonly codex: Projection;
  };
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
  const previewWorkDir = join(tmpdir(), "plugged-in", "preview", "claude-code");

  const claudeCodeActivation: Activation = { client: "claude-code", inventory, loadout: resolution };
  const codexActivation: Activation = { client: "codex", inventory, loadout: resolution };

  return {
    loadoutName,
    warnings,
    inventory,
    resolution,
    projections: {
      "claude-code": projectClaudeCode(claudeCodeActivation, previewWorkDir),
      codex: projectCodex(codexActivation),
    },
  };
}
