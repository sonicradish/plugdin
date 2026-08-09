// Vocabulary source of truth: CONTEXT.md. Do not rename these without updating it.

/** A coding agent runtime that loads Components, such as Claude Code or Codex. */
export type ClientId = "claude-code" | "codex";

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
  /** Present only for kind: "skill" — its SKILL.md frontmatter description, needed to write
   * a meaningful Annotation manifest (Phase 5). */
  readonly description?: string;
  /** Present only for kind: "skill". A loose skill needs Annotation on Claude Code. */
  readonly annotation?: SkillAnnotationState;
  /** Present only for kind: "mcp-server". The launch spec, for round-trip Projection. */
  readonly mcp?: McpServerSpec;
  /** Present only for kind: "plugin". The declaring marketplace, if any. */
  readonly marketplace?: string;
}

export type SkillAnnotationState = "annotated" | "unannotated" | "not-applicable";

/** A launch spec for an MCP server, captured faithfully enough to round-trip. */
export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** Raw fields this Client's config carries that pluggedin does not model explicitly. */
  readonly raw?: Readonly<Record<string, unknown>>;
}

/** The set of Components installed on a machine, discovered across all Clients. */
export interface Inventory {
  readonly components: readonly Component[];
  readonly discoveredAt: readonly ClientId[];
}

/** The starting point a Loadout is expressed against. */
export type Baseline =
  | { readonly kind: "all" }
  | { readonly kind: "none" }
  | { readonly kind: "loadout"; readonly name: string };

/** A named, reusable decision about which Components are active. */
export interface Loadout {
  readonly name: string;
  readonly baseline: Baseline;
  /** Component keys (ComponentId.key) explicitly turned on over the Baseline. */
  readonly allow: readonly string[];
  /** Component keys explicitly turned off over the Baseline. */
  readonly deny: readonly string[];
  /** Where this Loadout was defined: user-global or project-scoped. */
  readonly scope: "global" | "project";
  readonly definedAt: string;
}

/** The resolved on/off decision for every Component in an Inventory, under a Loadout. */
export interface Resolution {
  readonly loadoutName: string;
  readonly decisions: ReadonlyMap<string, boolean>;
}

/** A manifest file added beside an installed skill so a Client that cannot
 * otherwise address that skill can include it in a Loadout. */
export interface Annotation {
  readonly skillPath: string;
  readonly pluginJsonPath: string;
  readonly name: string;
}

/** Applying a Loadout to a single Client session. Bound to the session, not the machine. */
export interface Activation {
  readonly client: ClientId;
  readonly loadout: Resolution;
  readonly inventory: Inventory;
}

/** The native configuration produced for a specific Client from an Activation. */
export interface Projection {
  readonly client: ClientId;
  /** Argv fragments to append to the native launch command, in order. */
  readonly args: readonly string[];
  /** Ephemeral files this Projection wrote, for cleanup/inspection. */
  readonly generatedFiles: readonly GeneratedFile[];
  /** Components that could not be faithfully projected; launch should refuse if non-empty. */
  readonly refusals: readonly Refusal[];
}

export interface GeneratedFile {
  readonly path: string;
  readonly purpose: string;
  readonly contents: string;
}

export interface Refusal {
  readonly component: ComponentId;
  readonly reason: string;
}
