import type { DoctorReport } from "./doctor.js";

export function formatDoctor(report: DoctorReport): string {
  const lines: string[] = [];

  if (report.warnings.length > 0) {
    lines.push("Discovery warnings:");
    for (const w of report.warnings) lines.push(`  ${w.client}/${w.what}: ${w.reason}`);
    lines.push("");
  }

  lines.push(`Unannotated skills: ${report.unannotatedSkills.length}`);
  if (report.unannotatedSkills.length > 0) {
    lines.push("  (only matters for Claude Code — Codex reads skills natively, no adopt needed)");
  }
  for (const c of report.unannotatedSkills) lines.push(`  ${c.id.key} — run \`pluggedin adopt\` to make it addressable on Claude Code`);

  lines.push(`Drifted Annotations: ${report.driftedAnnotations.length}`);
  for (const d of report.driftedAnnotations) {
    lines.push(`  ${d.component.id.key} — manifest says "${d.manifestName}", skill is now "${d.component.name}"; re-run \`pluggedin adopt\``);
  }

  lines.push(`Foreign Annotations (left alone): ${report.foreignAnnotations.length}`);
  for (const c of report.foreignAnnotations) lines.push(`  ${c.id.key} — has a plugin.json pluggedin did not write`);

  lines.push(`Identity collisions: ${report.collisions.length}`);
  for (const c of report.collisions) lines.push(`  ${c.key} found at multiple paths: ${c.paths.join(", ")}`);

  lines.push(`Loadout keys with no matching Component: ${report.unknownLoadoutKeys.length}`);
  for (const u of report.unknownLoadoutKeys) {
    lines.push(`  ${u.loadoutName} (${u.loadoutPath}): "${u.key}" in ${u.field} matches nothing in the current Inventory`);
  }

  const clean = isClean(report);
  lines.push("");
  lines.push(clean ? "OK — no drift, no collisions, no dangling Loadout keys." : "Issues found — see above.");

  return lines.join("\n");
}

export function isClean(report: DoctorReport): boolean {
  return (
    report.unannotatedSkills.length === 0 &&
    report.driftedAnnotations.length === 0 &&
    report.collisions.length === 0 &&
    report.unknownLoadoutKeys.length === 0
  );
}
