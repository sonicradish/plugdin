import type { Activation, Projection, Refusal } from "../domain/types.js";

/**
 * Pi Projection: native flags only — no generated files, no environment overlay (ADR-0005).
 *
 * Pi is the one Client here whose CLI already expresses a Loadout directly. `--no-skills`
 * and `--no-extensions` turn off *discovery*, while explicit `--skill <path>` and
 * `-e <path>` arguments still load, so "discovery off + name the survivors" is a literal
 * allowlist. Confirmed in Pi's own resource loader (`dist/core/resource-loader.js`, read
 * 2026-08-09): with `noSkills` set, the enabled set is `cliEnabledSkills` merged with
 * `additionalSkillPaths` and the discovered set is dropped entirely; `noExtensions` does the
 * same for extensions.
 *
 * The two switches are emitted independently, and only when something of that kind is
 * actually off. With everything on, Pi launches with no flags at all rather than an
 * allowlist that merely reproduces the default — which keeps a Component this tool failed to
 * discover from being dropped as collateral by a `--no-skills` nobody needed.
 *
 * MCP servers: Pi has no native MCP; the `pi-mcp-adapter` extension supplies it, and its
 * `--mcp-config` flag only replaces the Pi-global config layer — the shared
 * `~/.config/mcp/mcp.json` and project `.mcp.json` still load and merge on top, and a server
 * entry has no `enabled` field to switch off (read from the adapter's `config.ts`). So
 * turning one off has no faithful mechanism at all: it warns rather than refuses, exactly as
 * Codex's MCP gap does (ADR-0004).
 */
export function projectPi(activation: Activation): Projection {
  const { inventory, loadout } = activation;
  const decisions = loadout.decisions;
  const warnings: Refusal[] = [];

  const skills = { on: [] as string[], anyOff: false };
  const packages = { extensionPaths: [] as string[], skillPaths: [] as string[], anyOff: false };

  for (const component of inventory.components) {
    if (!component.clients.includes("pi")) continue;
    const decision = decisions.get(component.id.key) ?? false;

    if (component.id.kind === "skill") {
      if (decision) skills.on.push(component.sourcePath);
      else skills.anyOff = true;
      continue;
    }

    if (component.id.kind === "plugin") {
      if (!decision) {
        packages.anyOff = true;
        continue;
      }
      packages.extensionPaths.push(...(component.piPackage?.extensionPaths ?? []));
      packages.skillPaths.push(...(component.piPackage?.skillPaths ?? []));
      continue;
    }

    if (component.id.kind === "mcp-server" && !decision) {
      warnings.push({
        component: component.id,
        reason:
          "Pi's MCP support comes from the pi-mcp-adapter extension, whose config layers merge and whose server entries have no enabled flag — there is no way to turn one off for a single session, so it is left as Pi's own config already has it",
      });
    }
  }

  const args: string[] = [];

  if (packages.anyOff) {
    args.push("--no-extensions");
    for (const path of packages.extensionPaths) args.push("--extension", path);
  }

  // A package's skills ride on the skills switch, not the extensions one — `--no-extensions`
  // stops Pi loading extension entry points, not the skill directories a package ships. So a
  // package being off also needs skill discovery off, with every surviving skill directory
  // (loose and package-supplied alike) named again explicitly.
  if (skills.anyOff || packages.anyOff) {
    args.push("--no-skills");
    for (const path of [...skills.on, ...packages.skillPaths]) args.push("--skill", path);
  }

  return {
    client: "pi",
    args,
    env: {},
    generatedFiles: [],
    mirrors: [],
    refusals: [],
    warnings,
    notes: [],
  };
}
