import { join, sep } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { Activation, GeneratedFile, GeneratedMirror, Projection, Refusal } from "../domain/types.js";

/** The one entry of Grok's config home a Projection replaces; everything else is symlinked. */
const CONFIG_FILE = "config.toml";

export interface GrokProjectionContext {
  /** Where the ephemeral config home is built. Nothing is written here by this function. */
  readonly workDir: string;
  /** The real Grok config home being mirrored, normally `~/.grok`. */
  readonly grokHome: string;
  /** Contents of the real `<grokHome>/config.toml`, carried forward so the ephemeral home
   * keeps the user's model, theme, and marketplace settings. Empty when they have none. */
  readonly baseConfigToml: string;
  /** Every directory Grok scans for skills, real (pre-mirror) paths. Needed because Grok
   * reports only the winner of a name collision — see `skillIgnorePaths`. */
  readonly skillRoots: readonly string[];
}

interface GrokConfig {
  skills?: { ignore?: string[] };
  plugins?: { disabled?: string[] };
  mcp_servers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/**
 * Grok Build Projection: an ephemeral `GROK_HOME` (ADR-0005).
 *
 * Unlike Codex, Grok has no `-c key=value` override and no config-path environment
 * variable — `grok --help` exposes neither, and the binary carries no `GROK_CONFIG*` symbol.
 * Its config layers are fixed on disk: `~/.grok/config.toml`, then `<repo-root>/.grok/`,
 * then `<cwd>/.grok/`. What it does have is `GROK_HOME`, which relocates the whole config
 * home. Pointing that at a directory of symlinks back into the real one — with only
 * `config.toml` replaced by a generated file — makes exactly one layer ephemeral and leaves
 * credentials, sessions, and caches resolving to the user's real files. Verified live
 * 2026-08-09: auth survives (`grok models` still reports a logged-in account), `[skills]
 * ignore` drops a skill from `grok inspect --json` (49 -> 48), and `[mcp_servers.<n>]
 * enabled` toggles a server's visibility in both `inspect` and `grok mcp list --json`.
 *
 * Skills: `[skills] ignore = [...]` takes paths, and only matches the path Grok itself
 * resolved — which for bundled skills is rooted at `GROK_HOME`, so those get rewritten onto
 * the mirror (`~/.grok/bundled/...` -> `<mirror>/bundled/...`). Verified live: ignoring a
 * bundled skill by its mirror path removes it.
 *
 * Plugins: `[plugins] disabled = [...]` takes plugin IDs. Documented in Grok's own README
 * but UNVERIFIED here — no plugin is installed in this environment to test against, the
 * same gap `spikes/FINDINGS.md` records for Claude Code's plugin list (S1).
 *
 * MCP servers: `enabled = false` only lands if the server is defined in the *user* layer,
 * the one this Projection replaces. A server coming from a project `.grok/config.toml`
 * outranks the user layer (Grok's docs: a project entry "replaces it entirely"), so turning
 * it off is unreachable from here and warns instead of refusing, per ADR-0004.
 */
export function projectGrok(activation: Activation, context: GrokProjectionContext): Projection {
  const { inventory, profile } = activation;
  const decisions = profile.decisions;
  const warnings: Refusal[] = [];

  const mirrorPath = join(context.workDir, "grok-home");
  const config = parseBaseConfig(context.baseConfigToml);
  const knownServers = new Set(Object.keys(config.mcp_servers ?? {}));

  const ignoredSkillPaths = new Set<string>();
  const disabledPluginKeys: string[] = [];

  // A name still wanted by some other skill Component must not be swept away wholesale.
  const keptSkillNames = new Set(
    inventory.components
      .filter((c) => c.id.kind === "skill" && c.clients.includes("grok") && (decisions.get(c.id.key) ?? false))
      .map((c) => c.name),
  );

  for (const component of inventory.components) {
    if (!component.clients.includes("grok")) continue;
    const decision = decisions.get(component.id.key) ?? false;

    if (component.id.kind === "skill") {
      if (decision) continue; // discovered by default; nothing to say
      for (const path of skillIgnorePaths(component, keptSkillNames, context)) {
        ignoredSkillPaths.add(onMirror(path, context.grokHome, mirrorPath));
      }
      continue;
    }

    if (component.id.kind === "plugin") {
      if (!decision) disabledPluginKeys.push(component.id.key);
      continue;
    }

    if (component.id.kind === "mcp-server") {
      if (!knownServers.has(component.name)) {
        // Defined by a layer this Projection cannot outrank (a project .grok/config.toml),
        // or by no layer this tool can see. Turning it ON needs nothing — it already loads.
        if (!decision) {
          warnings.push({
            component: component.id,
            reason: `"${component.name}" is not defined in Grok's user config.toml, so the ephemeral GROK_HOME cannot turn it off — a project .grok/config.toml entry replaces the user one outright. Left as Grok's own config already has it`,
          });
        }
        continue;
      }
      config.mcp_servers = { ...config.mcp_servers, [component.name]: { ...config.mcp_servers?.[component.name], enabled: decision } };
    }
  }

  if (ignoredSkillPaths.size > 0) {
    config.skills = { ...config.skills, ignore: [...(config.skills?.ignore ?? []), ...ignoredSkillPaths] };
  }
  if (disabledPluginKeys.length > 0) {
    config.plugins = { ...config.plugins, disabled: [...(config.plugins?.disabled ?? []), ...disabledPluginKeys] };
  }

  const configFile: GeneratedFile = {
    path: join(mirrorPath, CONFIG_FILE),
    purpose: "GROK_HOME/config.toml: the user's own config plus this Profile's skill, plugin, and MCP overrides",
    contents: stringifyToml(config) + "\n",
  };
  const mirror: GeneratedMirror = {
    path: mirrorPath,
    mirrorOf: context.grokHome,
    replaced: [CONFIG_FILE],
    purpose: "GROK_HOME: symlinks to the real config home so auth, sessions, and caches survive",
  };

  return {
    client: "grok",
    args: [],
    env: { GROK_HOME: mirrorPath },
    generatedFiles: [configFile],
    mirrors: [mirror],
    refusals: [],
    warnings,
    notes: [],
  };
}

/**
 * A malformed real config.toml is not this tool's to fix, and silently dropping it would
 * launch Grok with the user's model and marketplace settings quietly missing — so it
 * propagates as a parse error rather than being swallowed into an empty base.
 */
function parseBaseConfig(toml: string): GrokConfig {
  if (toml.trim().length === 0) return {};
  return parseToml(toml) as GrokConfig;
}

/**
 * Every path that has to be ignored for one skill to actually disappear from Grok.
 *
 * Grok deduplicates skills by name *before* reporting them, so `grok inspect --json` shows
 * only the winner of a collision — and ignoring that winner promotes the copy it was hiding.
 * Observed live 2026-08-09: ignoring `~/.grok/skills/docx` (which `inspect` had reported) let
 * a bundled `docx` that had never appeared in the Inventory take its place, and a Profile
 * allowing 4 skills launched Grok with 9. So a skill being turned off means ignoring the
 * path Grok reported *and* the same name under every other root Grok scans, whether or not
 * anything is currently there — ignoring a path that does not exist costs nothing.
 *
 * The sweep is skipped when another skill Component of the same name is staying on: there,
 * the collision is the point. Ignoring only the denied Component's own paths is what hands
 * the name to the copy the Profile kept.
 */
function skillIgnorePaths(
  component: { readonly name: string; readonly sourcePath: string; readonly clientPaths?: { readonly grok?: readonly string[] } },
  keptSkillNames: ReadonlySet<string>,
  context: GrokProjectionContext,
): string[] {
  const reported = component.clientPaths?.grok ?? [component.sourcePath];
  if (keptSkillNames.has(component.name)) return [...reported];
  return [...reported, ...context.skillRoots.map((root) => join(root, component.name))];
}

/** Rewrites a path inside the real config home onto the mirror standing in for it. */
function onMirror(path: string, grokHome: string, mirrorPath: string): string {
  const prefix = grokHome.endsWith(sep) ? grokHome : grokHome + sep;
  return path.startsWith(prefix) ? join(mirrorPath, path.slice(prefix.length)) : path;
}
