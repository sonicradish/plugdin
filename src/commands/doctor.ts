import { homedir } from "node:os";
import { join } from "node:path";
import { readAnnotation, isManagedByPlugdin } from "../adopt/annotate.js";
import { buildInventory, type DiscoveryWarning } from "../inventory/index.js";
import { discoverLooseSkills } from "../inventory/skills.js";
import { loadProfiles } from "../profile/store.js";
import type { Component } from "../domain/types.js";

export interface DriftedAnnotation {
  readonly component: Component;
  readonly manifestName: string;
}

export interface Collision {
  readonly key: string;
  readonly paths: readonly string[];
}

export interface UnknownProfileKey {
  readonly profileName: string;
  readonly profilePath: string;
  readonly field: "allow" | "deny";
  readonly key: string;
}

export interface DoctorReport {
  readonly warnings: readonly DiscoveryWarning[];
  readonly unannotatedSkills: readonly Component[];
  readonly driftedAnnotations: readonly DriftedAnnotation[];
  readonly foreignAnnotations: readonly Component[];
  readonly collisions: readonly Collision[];
  readonly unknownProfileKeys: readonly UnknownProfileKey[];
}

/**
 * Reports Annotation drift, unannotated skills, and identity collisions (PLAN.md Phase 5).
 * Drift specifically covers `npx skills update` (or a rename) clobbering or outdating an
 * Annotation plugdin wrote — spikes/s4-annotation-survival.md flagged this as something
 * `doctor` must catch since it can't yet be spiked live.
 */
export async function doctor(cwd: string = process.cwd(), claudeHome: string = join(homedir(), ".claude")): Promise<DoctorReport> {
  const { inventory, warnings } = await buildInventory(cwd, claudeHome);
  const skills = inventory.components.filter((c) => c.id.kind === "skill");

  const unannotatedSkills: Component[] = [];
  const driftedAnnotations: DriftedAnnotation[] = [];
  const foreignAnnotations: Component[] = [];

  for (const skill of skills) {
    // Annotation is a Claude Code shim (ADR-0003). A skill Claude Code cannot see in the
    // first place — Grok's bundled set, OpenCode's built-ins, Pi's own roots — is marked
    // "not-applicable" at discovery, and telling someone to `adopt` it would send them after
    // a fix that changes nothing.
    if (skill.annotation === "not-applicable") continue;
    const manifest = await readAnnotation(skill.sourcePath);
    if (!manifest) {
      unannotatedSkills.push(skill);
      continue;
    }
    if (!isManagedByPlugdin(manifest)) {
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
  const profiles = await loadProfiles(cwd);
  const unknownProfileKeys: UnknownProfileKey[] = [];
  for (const profile of profiles.values()) {
    const fields: Array<["allow" | "deny", readonly string[]]> = [
      ["allow", profile.allow],
      ["deny", profile.deny],
    ];
    for (const [field, keys] of fields) {
      for (const key of keys) {
        if (!knownKeys.has(key)) {
          unknownProfileKeys.push({ profileName: profile.name, profilePath: profile.definedAt, field, key });
        }
      }
    }
  }

  return { warnings, unannotatedSkills, driftedAnnotations, foreignAnnotations, collisions, unknownProfileKeys };
}
