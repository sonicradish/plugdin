import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Projection } from "../domain/types.js";

/**
 * Writes a Projection's generated files to disk for real, ahead of `run` actually launching
 * a Client. `explain` never calls this — it only inspects `Projection.generatedFiles` in
 * memory, so previewing a Loadout has zero filesystem side effects (PLAN.md Phase 1).
 */
export async function materializeProjection(projection: Projection): Promise<void> {
  for (const file of projection.generatedFiles) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, "utf8");
  }
}
