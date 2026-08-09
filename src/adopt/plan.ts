import { readAnnotation, isManagedByPluggedIn } from "./annotate.js";
import type { Component } from "../domain/types.js";

export type AdoptActionKind = "annotate" | "already-annotated" | "remove-annotation" | "skip-foreign-annotation";

export interface AdoptAction {
  readonly kind: AdoptActionKind;
  readonly component: Component;
}

/**
 * Plans Annotation writes/removals for every loose skill (Claude Code is the only Client
 * that needs this — ADR-0003). Never plans touching a foreign (non-pluggedin-managed)
 * `.claude-plugin/plugin.json`, forward or in reverse.
 */
export async function planAdopt(components: readonly Component[], opts: { readonly undo: boolean }): Promise<AdoptAction[]> {
  const skills = components.filter((c) => c.id.kind === "skill");
  const actions: AdoptAction[] = [];

  for (const component of skills) {
    const existing = await readAnnotation(component.sourcePath);
    const managed = isManagedByPluggedIn(existing);
    const foreign = existing !== undefined && !managed;

    if (opts.undo) {
      if (foreign) actions.push({ kind: "skip-foreign-annotation", component });
      else if (managed) actions.push({ kind: "remove-annotation", component });
      // else: nothing to undo, no action
      continue;
    }

    if (foreign) actions.push({ kind: "skip-foreign-annotation", component });
    else if (managed) actions.push({ kind: "already-annotated", component });
    else actions.push({ kind: "annotate", component });
  }

  return actions;
}
