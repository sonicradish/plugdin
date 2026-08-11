import { readAnnotation, isManagedByPlugdin } from "./annotate.js";
import type { Component } from "../domain/types.js";

export type AdoptActionKind = "annotate" | "already-annotated" | "remove-annotation" | "skip-foreign-annotation";

export interface AdoptAction {
  readonly kind: AdoptActionKind;
  readonly component: Component;
}

/**
 * Plans Annotation writes/removals for every loose skill (Claude Code is the only Client
 * that needs this — ADR-0003). Never plans touching a foreign (non-plugdin-managed)
 * `.claude-plugin/plugin.json`, forward or in reverse.
 *
 * Skills marked `not-applicable` are skipped: they are the ones Claude Code can't see in the
 * first place — OpenCode's built-ins, Grok's bundled set, Pi's own roots — so Annotating them
 * would change nothing. Some have no real path behind them either (OpenCode reports the
 * literal `<built-in>`), and writing to that relative path creates a junk directory under the
 * working directory instead.
 */
export async function planAdopt(components: readonly Component[], opts: { readonly undo: boolean }): Promise<AdoptAction[]> {
  const skills = components.filter((c) => c.id.kind === "skill" && c.annotation !== "not-applicable");
  const actions: AdoptAction[] = [];

  for (const component of skills) {
    const existing = await readAnnotation(component.sourcePath);
    const managed = isManagedByPlugdin(existing);
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
