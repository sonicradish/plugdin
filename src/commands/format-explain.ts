import { CLIENT_IDS, CLIENT_LABELS } from "../projection/index.js";
import { createPainter, type Painter } from "../util/color.js";
import type { ExplainResult } from "./explain.js";
import type { ClientId, Component } from "../domain/types.js";

function statusOf(result: ExplainResult, key: string): "on" | "off" {
  return result.resolution.decisions.get(key) ? "on" : "off";
}

function componentsFor(result: ExplainResult, client: ClientId): Component[] {
  return result.inventory.components.filter((c) => c.clients.includes(client));
}

function formatClientSection(result: ExplainResult, client: ClientId, label: string, p: Painter): string {
  const lines: string[] = [];
  lines.push(p.bold(p.cyan(`## ${label}`)));

  const components = componentsFor(result, client);
  if (components.length === 0) {
    lines.push(p.dim("  (no Components discovered for this Client)"));
  } else {
    const byKind = { plugin: [] as Component[], skill: [] as Component[], "mcp-server": [] as Component[] };
    for (const c of components) byKind[c.id.kind].push(c);
    for (const [kind, items] of Object.entries(byKind)) {
      if (items.length === 0) continue;
      lines.push(p.dim(`  ${kind}:`));
      for (const c of items) {
        const on = statusOf(result, c.id.key) === "on";
        const status = p.bold(on ? p.green("on ") : p.gray("off"));
        const why = p.dim(result.explicitKeys.has(c.id.key) ? " (explicit)" : " (baseline default)");
        const note = c.id.kind === "skill" ? p.dim(` (${c.annotation})`) : "";
        lines.push(`    [${status}] ${c.id.key}${why}${note}`);
      }
    }
  }

  const projection = result.projections[client];
  lines.push("");
  lines.push(p.dim("  native launch args:"));
  lines.push(projection.args.length > 0 ? `    ${projection.args.join(" ")}` : p.dim("    (none — native defaults apply)"));

  const envEntries = Object.entries(projection.env);
  if (envEntries.length > 0) {
    lines.push("");
    lines.push(p.dim("  launch environment:"));
    for (const [name, value] of envEntries) lines.push(`    ${name}=${value}`);
  }

  if (projection.mirrors.length > 0) {
    lines.push("");
    lines.push(p.dim("  ephemeral config home:"));
    for (const mirror of projection.mirrors) {
      lines.push(p.dim(`    ${mirror.path} — symlinks to ${mirror.mirrorOf}, except ${mirror.replaced.join(", ")}`));
    }
  }

  if (projection.generatedFiles.length > 0) {
    lines.push("");
    lines.push(p.dim("  generated config:"));
    for (const file of projection.generatedFiles) {
      lines.push(p.dim(`    ${file.path} (${file.purpose})`));
      for (const contentLine of file.contents.trimEnd().split("\n")) lines.push(`      ${contentLine}`);
    }
  }

  if (projection.refusals.length > 0) {
    lines.push("");
    lines.push(p.bold(p.red("  REFUSED — launching with this Loadout would misrepresent what's active:")));
    for (const refusal of projection.refusals) {
      lines.push(p.red(`    ${refusal.component.kind} ${refusal.component.key}: ${refusal.reason}`));
    }
  }

  if (projection.warnings.length > 0) {
    lines.push("");
    lines.push(p.bold(p.yellow("  NOTE — non-blocking, left as the Client's own config already has it:")));
    for (const warning of projection.warnings) {
      lines.push(p.yellow(`    ${warning.component.kind} ${warning.component.key}: ${warning.reason}`));
    }
  }

  if (projection.notes.length > 0) {
    lines.push("");
    lines.push(p.bold(p.yellow("  HOW THIS CLIENT ENFORCES IT:")));
    for (const note of projection.notes) lines.push(p.yellow(`    ${note}`));
  }

  return lines.join("\n");
}

export interface FormatExplainOptions {
  readonly color: boolean;
}

export function formatExplain(result: ExplainResult, options: FormatExplainOptions = { color: false }): string {
  const p = createPainter(options.color);
  const sections: string[] = [];
  sections.push(p.bold(`Loadout: ${result.loadoutName}`));

  if (result.warnings.length > 0) {
    sections.push("");
    sections.push(p.yellow("Discovery warnings:"));
    for (const w of result.warnings) sections.push(p.yellow(`  ${w.client}/${w.what}: ${w.reason}`));
  }

  for (const client of CLIENT_IDS) {
    sections.push("");
    sections.push(formatClientSection(result, client, CLIENT_LABELS[client], p));
  }

  const anyRefusals = Object.values(result.projections).some((proj) => proj.refusals.length > 0);
  if (anyRefusals) {
    sections.push("");
    sections.push(p.bold(p.red("pluggedin run would refuse to launch until the REFUSED items above are resolved.")));
  }

  return sections.join("\n");
}
