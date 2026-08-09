import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ANNOTATION_TOOL_MARKER = "pluggedin adopt";

export interface AnnotationManifest {
  readonly name: string;
  readonly description: string;
  readonly pluggedIn: { readonly annotates: string; readonly tool: string };
}

export function annotationPath(skillDir: string): string {
  return join(skillDir, ".claude-plugin", "plugin.json");
}

/** Reads and parses a skill's `.claude-plugin/plugin.json`, if any. Never throws. */
export async function readAnnotation(skillDir: string): Promise<AnnotationManifest | undefined> {
  const path = annotationPath(skillDir);
  if (!existsSync(path)) return undefined;
  try {
    const contents = await readFile(path, "utf8");
    return JSON.parse(contents) as AnnotationManifest;
  } catch {
    return undefined;
  }
}

/** True only for Annotations pluggedin itself wrote — `adopt --undo` and `doctor` must
 * never touch a hand-authored `.claude-plugin/plugin.json` that happens to sit beside a skill. */
export function isManagedByPluggedIn(manifest: AnnotationManifest | undefined): boolean {
  return manifest?.pluggedIn?.tool === ANNOTATION_TOOL_MARKER;
}

/**
 * Writes `.claude-plugin/plugin.json` beside a skill so Claude Code loads it as
 * `<name>@skills-dir`, addressable by `enabledPlugins` (ADR-0003). Idempotent: writing the
 * same (name, description) twice produces byte-identical output.
 */
export async function writeAnnotation(skillDir: string, name: string, description: string): Promise<void> {
  const manifest: AnnotationManifest = { name, description, pluggedIn: { annotates: name, tool: ANNOTATION_TOOL_MARKER } };
  const path = annotationPath(skillDir);
  await mkdir(join(skillDir, ".claude-plugin"), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/** Removes a pluggedin-managed Annotation. Refuses to remove a foreign one. */
export async function removeAnnotation(skillDir: string): Promise<void> {
  const manifest = await readAnnotation(skillDir);
  if (!isManagedByPluggedIn(manifest)) return;
  await rm(annotationPath(skillDir), { force: true });
}
