import { removeAnnotation, writeAnnotation } from "./annotate.js";
import type { AdoptAction } from "./plan.js";

export interface AppliedAction {
  readonly action: AdoptAction;
  readonly applied: boolean;
}

/** Executes a plan from `planAdopt`. With `dryRun`, computes the same actions but writes nothing. */
export async function applyAdopt(actions: readonly AdoptAction[], opts: { readonly dryRun: boolean }): Promise<AppliedAction[]> {
  const results: AppliedAction[] = [];
  for (const action of actions) {
    if (action.kind === "annotate" && !opts.dryRun) {
      await writeAnnotation(action.component.sourcePath, action.component.name, action.component.description ?? "");
    }
    if (action.kind === "remove-annotation" && !opts.dryRun) {
      await removeAnnotation(action.component.sourcePath);
    }
    const applied = !opts.dryRun && (action.kind === "annotate" || action.kind === "remove-annotation");
    results.push({ action, applied });
  }
  return results;
}
