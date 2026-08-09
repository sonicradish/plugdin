import { homedir } from "node:os";
import { join } from "node:path";
import { applyAdopt, type AppliedAction } from "../adopt/apply.js";
import { planAdopt } from "../adopt/plan.js";
import { buildInventory } from "../inventory/index.js";

export interface AdoptOptions {
  readonly dryRun: boolean;
  readonly undo: boolean;
}

export async function adopt(
  cwd: string = process.cwd(),
  opts: AdoptOptions = { dryRun: false, undo: false },
  claudeHome: string = join(homedir(), ".claude"),
): Promise<AppliedAction[]> {
  const { inventory } = await buildInventory(cwd, claudeHome);
  const plan = await planAdopt(inventory.components, { undo: opts.undo });
  return applyAdopt(plan, { dryRun: opts.dryRun });
}

export function formatAdoptResult(results: readonly AppliedAction[], opts: AdoptOptions): string {
  if (results.length === 0) return "No skills found.";
  const lines: string[] = [];
  const verb = opts.dryRun ? "would" : "did";
  for (const { action, applied } of results) {
    const key = action.component.id.key;
    switch (action.kind) {
      case "annotate":
        lines.push(`[${applied || opts.dryRun ? "annotate" : "skip  "}] ${key} — ${verb} write .claude-plugin/plugin.json`);
        break;
      case "already-annotated":
        lines.push(`[skip  ] ${key} — already Annotated`);
        break;
      case "remove-annotation":
        lines.push(`[${applied || opts.dryRun ? "remove" : "skip  "}] ${key} — ${verb} remove .claude-plugin/plugin.json`);
        break;
      case "skip-foreign-annotation":
        lines.push(`[skip  ] ${key} — has a .claude-plugin/plugin.json plugdin did not write; leaving it alone`);
        break;
    }
  }
  return lines.join("\n");
}
