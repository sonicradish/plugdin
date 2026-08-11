// Vocabulary source of truth: CONTEXT.md. Do not rename these without updating it.

/** A coding agent runtime that loads Components, such as Claude Code or Codex. */
export type ClientId = "claude-code" | "codex" | "grok" | "opencode" | "pi";

/** The kind of governable unit a Component is. */
export type ComponentKind = "plugin" | "skill" | "mcp-server";

/**
 * Canonical identity for a Component. Plugins and Annotated skills are keyed
 * `name@marketplace` because both Clients already key plugins that way
 * (PLAN.md "Verified foundations"). MCP servers have no such natural key, so
 * they are fingerprinted from their launch command.
 */
export interface ComponentId {
  readonly kind: ComponentKind;
  /** e.g. "code-review@claude-plugins-official", or an MCP command fingerprint. */
  readonly key: string;
}

/** A single governable unit of agent extension: a plugin, a skill, or an MCP server. */
export interface Component {
  readonly id: ComponentId;
  /** Human-facing name, as the Client would display it. */
  readonly name: string;
  /** Which Client(s) this installation was discovered under. */
  readonly clients: readonly ClientId[];
  /** Where on disk this Component (or its defining config entry) lives. */
  readonly sourcePath: string;
  /** Every path a specific Client resolves this Component from, where those differ from
   * `sourcePath`. Grok reports skills through paths rooted at its own config home, and its
   * `[skills] ignore` list matches only the exact path Grok itself resolved — so a skill
   * shared with the other Clients needs Grok's spelling of it kept alongside the shared one.
   * A list rather than one path because the same skill genuinely arrives by several routes:
   * `~/.claude/skills/x` and the `~/.agents/skills/x` it symlinks to are one skill reachable
   * two ways, and turning it off means naming both. */
  readonly clientPaths?: Readonly<Partial<Record<ClientId, readonly string[]>>>;
  /** Present only for kind: "skill" — its SKILL.md frontmatter description, needed to write
   * a meaningful Annotation manifest (Phase 5). */
  readonly description?: string;
  /** Present only for kind: "skill". A loose skill needs Annotation on Claude Code. */
  readonly annotation?: SkillAnnotationState;
  /** Present only for kind: "mcp-server". The launch spec, for round-trip Projection. */
  readonly mcp?: McpServerSpec;
  /** Present only for a Pi package. Pi has no per-package toggle — it re-enables resources
   * by path on the command line — so the paths a package contributes are captured at
   * discovery, where its `package.json` is already being read. */
  readonly piPackage?: PiPackageResources;
  /** Present only for kind: "plugin". The declaring marketplace, if any. */
  readonly marketplace?: string;
}

export type SkillAnnotationState = "annotated" | "unannotated" | "not-applicable";

/** A launch spec for an MCP server, captured faithfully enough to round-trip. */
export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** Raw fields this Client's config carries that plugdin does not model explicitly. */
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** What a Pi package contributes, resolved to absolute paths from its `package.json` `pi`
 * field, so Projection can hand each back to Pi as `-e` / `--skill` arguments. */
export interface PiPackageResources {
  readonly extensionPaths: readonly string[];
  readonly skillPaths: readonly string[];
}

/** The set of Components installed on a machine, discovered across all Clients. */
export interface Inventory {
  readonly components: readonly Component[];
  readonly discoveredAt: readonly ClientId[];
}

/** The starting point a Profile is expressed against. */
export type Baseline =
  | { readonly kind: "all" }
  | { readonly kind: "none" }
  | { readonly kind: "profile"; readonly name: string };

/** A named, reusable decision about which Components are active. */
export interface Profile {
  readonly name: string;
  readonly baseline: Baseline;
  /** Component keys (ComponentId.key) explicitly turned on over the Baseline. */
  readonly allow: readonly string[];
  /** Component keys explicitly turned off over the Baseline. */
  readonly deny: readonly string[];
  /** Where this Profile was defined: user-global or project-scoped. */
  readonly scope: "global" | "project";
  readonly definedAt: string;
}

/** The resolved on/off decision for every Component in an Inventory, under a Profile. */
export interface Resolution {
  readonly profileName: string;
  readonly decisions: ReadonlyMap<string, boolean>;
}

/** A manifest file added beside an installed skill so a Client that cannot
 * otherwise address that skill can include it in a Profile. */
export interface Annotation {
  readonly skillPath: string;
  readonly pluginJsonPath: string;
  readonly name: string;
}

/** Applying a Profile to a single Client session. Bound to the session, not the machine. */
export interface Activation {
  readonly client: ClientId;
  readonly profile: Resolution;
  readonly inventory: Inventory;
}

/** The native configuration produced for a specific Client from an Activation. */
export interface Projection {
  readonly client: ClientId;
  /** Argv fragments to append to the native launch command, in order. */
  readonly args: readonly string[];
  /** Environment overlay for the launched Client process. Some Clients expose no launch
   * flag for their config at all and read an env var instead (OpenCode's
   * `OPENCODE_CONFIG_CONTENT`, Grok's `GROK_HOME`) — ADR-0005. Applied over the inherited
   * environment, never replacing it. */
  readonly env: Readonly<Record<string, string>>;
  /** Ephemeral files this Projection wrote, for cleanup/inspection. */
  readonly generatedFiles: readonly GeneratedFile[];
  /** Ephemeral config-home mirrors this Projection needs (Grok only — ADR-0005). */
  readonly mirrors: readonly GeneratedMirror[];
  /** Components that could not be faithfully projected; launch should refuse if non-empty. */
  readonly refusals: readonly Refusal[];
  /** Client-level remarks about *how* this Projection enforces a decision, where the
   * mechanism differs from "the Component is simply not there" — always displayed, never
   * blocking. Distinct from `warnings`: a note describes a decision that WAS projected
   * (OpenCode denies a skill at the permission layer, so it cannot run but stays listed in
   * the model's catalog), where a warning describes one that could not be. */
  readonly notes: readonly string[];
  /** Components that could not be faithfully projected but launch proceeds anyway, leaving
   * the Component in whatever state the Client's own config already has it — printed as a
   * heads-up, never blocks (ADR-0004). Distinct from `refusals`: a `Refusal` has a fix
   * available through this tool; a warning does not, so blocking on it would only be friction. */
  readonly warnings: readonly Refusal[];
}

export interface GeneratedFile {
  readonly path: string;
  readonly purpose: string;
  readonly contents: string;
}

/**
 * An ephemeral directory filled with symlinks back into a Client's real config home, so a
 * generated config file can stand in for one entry of that home without the launch losing
 * the credentials, sessions, and caches living beside it (ADR-0005). Declared here rather
 * than performed inline so Projection stays free of filesystem I/O and `explain` can print
 * what a launch *would* build; `materializeProjection` is what actually creates it.
 */
export interface GeneratedMirror {
  /** The ephemeral directory to create and fill with symlinks. */
  readonly path: string;
  /** The real config home whose entries are symlinked into `path`. */
  readonly mirrorOf: string;
  /** Entry names deliberately NOT symlinked, because a GeneratedFile replaces each. */
  readonly replaced: readonly string[];
  readonly purpose: string;
}

export interface Refusal {
  readonly component: ComponentId;
  readonly reason: string;
}
