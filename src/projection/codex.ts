import type { Activation, Projection, Refusal } from "../domain/types.js";

/** Minimal TOML string-literal escaping for values embedded in a `-c key=value` argument. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Codex Projection (PLAN.md Phase 4): repeated `-c` overrides, no profile file.
 *
 * Plugins: `-c plugins."<key>".enabled=<bool>` for every plugin — directly confirmed to
 * parse (spikes/s5-arg-list-size.sh) and matches Codex's own config.toml shape.
 *
 * Skills: `-c skills.config=[...]` listing EVERY skill, not just the ones changed. S3
 * (spikes/s3-codex-skills-config.md, whether this merges or replaces the existing array) is
 * unresolved; enumerating the full set is correct either way, which is why Phase 4 doesn't
 * need S3 answered to ship — it only needs it answered to *optimize* toward emitting deltas.
 *
 * MCP servers: the "Verified foundations" table found `mcp_servers.<n>` is a 27-field
 * struct with no bare toggle. We only capture (command, args, env) from discovery — nowhere
 * near 27 fields — so re-emitting a server to change its state would be a lossy round-trip.
 * Turning one ON needs no override (it's already in the user's config.toml and loads by
 * default). Turning one OFF has no verified faithful mechanism — there is nothing a caller
 * can *do* about that through this tool, so unlike other gaps this one is a non-blocking
 * `warnings` entry rather than a `refusals` entry (ADR-0004): launch proceeds and the server
 * is simply left in whatever state Codex's own config already has it (usually on).
 */
export function projectCodex(activation: Activation): Projection {
  const { inventory, loadout } = activation;
  const decisions = loadout.decisions;
  const args: string[] = [];
  const refusals: Refusal[] = [];
  const warnings: Refusal[] = [];

  const skillOverrides: string[] = [];

  for (const component of inventory.components) {
    if (!component.clients.includes("codex")) continue;
    const decision = decisions.get(component.id.key) ?? false;

    if (component.id.kind === "plugin") {
      args.push("-c", `plugins.${tomlString(component.id.key)}.enabled=${decision}`);
      continue;
    }

    if (component.id.kind === "skill") {
      skillOverrides.push(`{name=${tomlString(component.name)},enabled=${decision}}`);
      continue;
    }

    if (component.id.kind === "mcp-server") {
      if (decision) continue; // already on by default; no override needed
      warnings.push({
        component: component.id,
        reason:
          "no verified way to disable an already-configured Codex MCP server without a lossy re-emission of its full config entry, which this tool only captures a subset of the fields for — leaving it as Codex's own config already has it",
      });
    }
  }

  if (skillOverrides.length > 0) {
    args.push("-c", `skills.config=[${skillOverrides.join(",")}]`);
  }

  return { client: "codex", args, generatedFiles: [], refusals, warnings };
}
