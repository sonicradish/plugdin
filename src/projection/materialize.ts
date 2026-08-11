import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GeneratedMirror, Projection } from "../domain/types.js";

/**
 * Writes a Projection's mirrors and generated files to disk for real, ahead of `run`
 * actually launching a Client. `explain` never calls this — it only inspects
 * `Projection.generatedFiles` in memory, so previewing a Profile has zero filesystem side
 * effects (PLAN.md Phase 1).
 *
 * Mirrors are built before files, since a Projection's generated file is normally the one
 * entry of the mirrored home the mirror deliberately left out.
 */
export async function materializeProjection(projection: Projection): Promise<void> {
  for (const mirror of projection.mirrors) {
    await materializeMirror(mirror);
  }
  for (const file of projection.generatedFiles) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.contents, "utf8");
  }
}

/**
 * Fills an ephemeral directory with one symlink per entry of a Client's real config home
 * (ADR-0005). Symlinks, not copies: the Client's own writes during the session — sessions,
 * caches, credential refreshes — then land in the user's real files rather than being
 * stranded in a temp directory that gets thrown away.
 */
async function materializeMirror(mirror: GeneratedMirror): Promise<void> {
  await mkdir(mirror.path, { recursive: true });
  const entries = await readdir(mirror.mirrorOf).catch(() => [] as string[]);
  for (const entry of entries) {
    if (mirror.replaced.includes(entry)) continue;
    // Already-linked entries are fine: a Projection may be materialized more than once.
    await symlink(join(mirror.mirrorOf, entry), join(mirror.path, entry)).catch(() => undefined);
  }
}
