import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { projectClaudeCode } from "./claude-code.js";
import { projectCodex } from "./codex.js";
import { projectGrok } from "./grok.js";
import { projectOpenCode } from "./opencode.js";
import { projectPi } from "./pi.js";
import type { Activation, ClientId, Inventory, Projection, Resolution } from "../domain/types.js";

/** Every Client plugdin can project a Loadout onto, in display order. */
export const CLIENT_IDS: readonly ClientId[] = ["claude-code", "codex", "grok", "opencode", "pi"];

export const CLIENT_LABELS: Readonly<Record<ClientId, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  grok: "Grok Build",
  opencode: "OpenCode",
  pi: "Pi",
};

/**
 * The reads a Projection needs but must not perform itself. Projection is pure so `explain`
 * can preview a launch without touching the filesystem (PLAN.md Phase 1); anything it needs
 * off disk is gathered here first, once, by the caller.
 */
export interface ProjectionContext {
  /** Where each Client's ephemeral files and config-home mirrors are rooted. */
  readonly workDir: string;
  readonly grokHome: string;
  /** Contents of the real `<grokHome>/config.toml`, or "" when the user has none. */
  readonly grokBaseConfigToml: string;
  readonly grokSkillRoots: readonly string[];
}

/**
 * Every directory Grok scans for skills, per its own docs plus what `grok inspect --json`
 * was observed to report: its config home's `skills/` and `bundled/skills/`, the shared
 * `~/.claude/skills/` (and the `~/.agents/skills/` those entries symlink to, which is the
 * spelling Grok reports), and the project's own `.grok/skills/`.
 */
function grokSkillRoots(grokHome: string, cwd: string): string[] {
  return [
    join(grokHome, "skills"),
    join(grokHome, "bundled", "skills"),
    join(homedir(), ".claude", "skills"),
    join(homedir(), ".agents", "skills"),
    join(cwd, ".grok", "skills"),
  ];
}

export async function gatherProjectionContext(
  workDir: string,
  cwd: string = process.cwd(),
  grokHome: string = join(homedir(), ".grok"),
): Promise<ProjectionContext> {
  const grokBaseConfigToml = await readFile(join(grokHome, "config.toml"), "utf8").catch(() => "");
  return { workDir, grokHome, grokBaseConfigToml, grokSkillRoots: grokSkillRoots(grokHome, cwd) };
}

export function projectFor(client: ClientId, activation: Activation, context: ProjectionContext): Projection {
  switch (client) {
    case "claude-code":
      return projectClaudeCode(activation, join(context.workDir, "claude-code"));
    case "codex":
      return projectCodex(activation);
    case "grok":
      return projectGrok(activation, {
        workDir: context.workDir,
        grokHome: context.grokHome,
        baseConfigToml: context.grokBaseConfigToml,
        skillRoots: context.grokSkillRoots,
      });
    case "opencode":
      return projectOpenCode(activation);
    case "pi":
      return projectPi(activation);
  }
}

/** Every Client's Projection of one Resolution, for `explain` and the Loadout picker. */
export function projectAll(inventory: Inventory, loadout: Resolution, context: ProjectionContext): Record<ClientId, Projection> {
  const projections = {} as Record<ClientId, Projection>;
  for (const client of CLIENT_IDS) {
    projections[client] = projectFor(client, { client, inventory, loadout }, context);
  }
  return projections;
}
