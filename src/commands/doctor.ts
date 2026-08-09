import { homedir } from "node:os";
import { join } from "node:path";
import { readAnnotation, isManagedByPluggedIn } from "../adopt/annotate.js";
import { buildInventory, type DiscoveryWarning } from "../inventory/index.js";
import { discoverLooseSkills } from "../inventory/skills.js";
import { loadLoadouts } from "../loadout/store.js";
import type { Component } from "../domain/types.js";

export interface DriftedAnnotation {
  readonly component: Component;
  readonly manifestName: string;
}

export interface Collision {
  readonly key: string;
  readonly paths: readonly string[];
}

export interface UnknownLoadoutKey {
  readonly loadoutName: string;
  readonly loadoutPath: string;
  readonly field: "allow" | "deny";
  readonly key: string;
}

export interface DoctorReport {
  readonly warnings: readonly DiscoveryWarning[];
  readonly unannotatedSkills: readonly Component[];
  readonly driftedAnnotations: readonly DriftedAnnotation[];
  readonly foreignAnnotations: readonly Component[];
  readonly collisions: readonly Collision[];
  readonly unknownLoadoutKeys: readonly UnknownLoadoutKey[];
}

/**
 * Reports Annotation drift, unannotated skills, and identity collisions (PLAN.md Phase 5).
 * Drift specifically covers `npx skills update` (or a rename) clobbering or outdating an
 * Annotation pluggedin wrote — spikes/s4-annotation-survival.md flagged this as something
 * `doctor` must catch since it can't yet be spiked live.
 */
export async function doctor(cwd: string = process.cwd(), claudeHome: string = join(homedir(), ".claude")): Promise<DoctorReport> {
  const { inventory, warnings } = await buildInventory(cwd, claudeHome);
  const skills = inventory.components.filter((c) => c.id.kind === "skill");

  const unannotatedSkills: Component[] = [];
  const driftedAnnotations: DriftedAnnotation[] = [];
  const foreignAnnotations: Component[] = [];

  for (const skill of skills) {
    const manifest = await readAnnotation(skill.sourcePath);
    if (!manifest) {
      unannotatedSkills.push(skill);
      continue;
    }
    if (!isManagedByPluggedIn(manifest)) {
      foreignAnnotations.push(skill);
      continue;
    }
    if (manifest.name !== skill.name) {
      driftedAnnotations.push({ component: skill, manifestName: manifest.name });
    }
  }

  const roots = [join(claudeHome, "skills"), join(cwd, ".claude", "skills")];
  const seenAt = new Map<string, string[]>();
  for (const root of roots) {
    for (const skill of await discoverLooseSkills(root)) {
      const key = `${skill.name}@skills-dir`;
      seenAt.set(key, [...(seenAt.get(key) ?? []), skill.dir]);
    }
  }
  const collisions: Collision[] = [...seenAt.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([key, paths]) => ({ key, paths }));

  const knownKeys = new Set(inventory.components.map((c) => c.id.key));
  const loadouts = await loadLoadouts(cwd);
  const unknownLoadoutKeys: UnknownLoadoutKey[] = [];
  for (const loadout of loadouts.values()) {
    const fields: Array<["allow" | "deny", readonly string[]]> = [
      ["allow", loadout.allow],
      ["deny", loadout.deny],
    ];
    for (const [field, keys] of fields) {
      for (const key of keys) {
        if (!knownKeys.has(key)) {
          unknownLoadoutKeys.push({ loadoutName: loadout.name, loadoutPath: loadout.definedAt, field, key });
        }
      }
    }
  }

  return { warnings, unannotatedSkills, driftedAnnotations, foreignAnnotations, collisions, unknownLoadoutKeys };
}
