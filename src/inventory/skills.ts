import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Component } from "../domain/types.js";

interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
}

/**
 * Minimal frontmatter reader for SKILL.md: `---\nkey: value\n...\n---`. Every skill in this
 * ecosystem uses single-line `key: value` pairs (verified by inspecting every SKILL.md under
 * ~/.claude/skills/ in this environment) — a full YAML parser is more than this needs.
 */
export function parseSkillFrontmatter(contents: string): SkillFrontmatter | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(contents);
  if (!match) return undefined;
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    let value = kv[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  if (!fields.name || !fields.description) return undefined;
  return { name: fields.name, description: fields.description };
}

/**
 * A loose skill is Annotated once `.claude-plugin/plugin.json` sits beside SKILL.md
 * (ADR-0003). This only checks for the file's presence — it does not validate that the
 * Annotation still matches the skill's current name, which is `doctor`'s job (Phase 5).
 */
export function isAnnotated(skillDir: string): boolean {
  return existsSync(join(skillDir, ".claude-plugin", "plugin.json"));
}

/**
 * Skills living under `~/.claude/skills/` are visible to both Clients (PLAN.md: "Codex
 * already discovers skills in ~/.claude/skills/. Cross-client skill sharing is an existing
 * fact"), so discovery is client-agnostic; callers attach the `clients` list.
 *
 * Entries are frequently symlinks (confirmed live: this environment's `~/.claude/skills/`
 * is a farm of symlinks into `~/.agents/skills/`, a second real shared root) — `Dirent`
 * reports the link's own type, not its target's, so this checks with `stat` (which follows
 * symlinks) rather than `entry.isDirectory()`.
 */
export async function discoverLooseSkills(skillsRoot: string): Promise<
  Array<{ readonly name: string; readonly description: string; readonly dir: string; readonly annotated: boolean }>
> {
  if (!existsSync(skillsRoot)) return [];
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const results: Array<{ name: string; description: string; dir: string; annotated: boolean }> = [];
  for (const entry of entries) {
    const dir = join(skillsRoot, entry.name);
    const dirStat = await stat(dir).catch(() => undefined);
    if (!dirStat?.isDirectory()) continue;
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) continue;
    const st = await stat(skillMd).catch(() => undefined);
    if (!st?.isFile()) continue;
    const contents = await readFile(skillMd, "utf8");
    const frontmatter = parseSkillFrontmatter(contents);
    if (!frontmatter) continue;
    results.push({
      name: frontmatter.name,
      description: frontmatter.description,
      dir,
      annotated: isAnnotated(dir),
    });
  }
  return results;
}

export function skillToComponent(
  skill: { readonly name: string; readonly description: string; readonly dir: string; readonly annotated: boolean },
  clients: readonly Component["clients"][number][],
): Component {
  return {
    id: { kind: "skill", key: `${skill.name}@skills-dir` },
    name: skill.name,
    clients,
    sourcePath: skill.dir,
    description: skill.description,
    annotation: skill.annotated ? "annotated" : "unannotated",
  };
}
