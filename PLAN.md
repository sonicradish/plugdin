# plugdin — build plan

A CLI that decides which plugins, skills, and MCP servers appear to a coding agent in a given
session, and makes that decision reusable and portable across agent clients.

Vocabulary in [CONTEXT.md](./CONTEXT.md). Settled architecture in [docs/adr/](./docs/adr/).

## The problem, stated precisely

Agent Plugins v1 standardizes how extensions are *packaged* and explicitly leaves
"discovery, installation, permissions, and UX" to each client. So a plugin is portable and a
decision about that plugin is not. plugdin supplies the missing portable state.

The goal is **context optimization**: a Component that is off must not reach the model's
context at all. Blocking a Component at the permission layer does not count — verified: a
skill denied with `Skill(name *)` still appears in full in the model's skill list.

## Verified foundations

Everything in this table was run against Claude Code and Codex CLI 0.147.0, not read in docs.

| Component | Claude Code | Codex |
|---|---|---|
| Plugins | `enabledPlugins` map via `--settings` | `-c plugins."name@marketplace".enabled=false` |
| Loose skills | no native filter → Annotation to `<name>@skills-dir`, then `enabledPlugins` | `-c skills.config=[{name="…",enabled=false}]`, native |
| MCP servers | `--mcp-config` + `--strict-mcp-config`, full set re-emitted | re-emit server entries; `mcp_servers.<n>` is a 27-field struct with no bare toggle |
| Auth under override | survives flags; **breaks** under `CLAUDE_CONFIG_DIR` | survives, even under `--ignore-user-config` |

Two incidental findings that shape the design:

- Codex already discovers skills in `~/.claude/skills/`. Cross-client skill sharing is an
  existing fact, not something to build.
- Both clients key plugins as `name@marketplace`, so a canonical Component identity is
  cheaper than expected.

Three mechanisms were documented one way and behaved another. Assume the next one will too.

## Architecture

- **Selection, not installation.** `npx plugins` and `npx skills` install; plugdin reads
  the resulting Inventory and decides what is active. ADR-0002.
- **Ephemeral Projection.** Each Activation generates throwaway config passed through flags
  the client already supports. Nothing the user owns is mutated to express activation, so a
  crash cannot leave a machine wrong and two terminals can differ. ADR-0001.
- **Annotation only where required.** Claude Code needs a `.claude-plugin/plugin.json` shim
  beside each skill; Codex does not. One-time, additive, reversible. ADR-0003.
- **Fail closed, but only when asked.** A new Loadout starts at baseline `none`. Running the
  wrapper without naming a Loadout uses the project default, else `all`. Not using plugdin
  at all changes nothing — native behavior, always.

## Phase 0 — Spikes

Each can invalidate design. Do them before writing product code. Each is a two-run probe:
baseline, then modified, diffing what the model reports it can see.

| # | Question | Invalidates |
|---|---|---|
| S1 | Is `enabledPlugins` an allowlist ("only these load") or a per-key override? Probe with two installed plugins, disabling one. | The whole `baseline: all` projection path |
| S2 | Does `--strict-mcp-config` also suppress plugin-provided MCP servers? | Loadouts that enable a plugin could silently lose its server |
| S3 | Does Codex `skills.config` replace or merge with the user's existing array? | Whether Projection must enumerate the full Inventory every launch |
| S4 | Does `npx skills update` preserve or clobber an Annotation? | Whether `doctor` drift detection is nice-to-have or load-bearing |
| S5 | Does a large Inventory blow the `-c` argument list on Codex? | `-c`-only projection; may force a profile file after all |

## Phase 1 — Inventory and `explain`

Read-only and shippable on its own. Discover installed Components across both clients,
resolve canonical identity (`plugin.json` `name` for plugins; command+args fingerprint for
MCP servers, with user-pinnable aliases), and print what a given Loadout *would* produce —
exact flags, exact generated config, diffed against the originals.

`explain` is a v1 requirement, not a nicety. Every mechanism here is an indirection between
what the user asked for and what the agent sees; without it, bugs are unfalsifiable.

## Phase 2 — Loadout model

TOML at `~/.plugdin/loadouts/<name>.toml` and `<repo>/.plugdin/loadouts/<name>.toml`,
committed. Project overrides global **by name**, never merges — merged allow/deny sets across
scopes cannot be debugged. A project may declare a default Loadout; it may never force one.

A Loadout is a set of allows and denies over a Baseline of `all`, `none`, or another Loadout.
Resolution is a function of the live Inventory, so a `baseline: all` Loadout picks up newly
installed Components and a `baseline: none` one does not.

## Phase 3 — Claude Code Projection

Generate a settings object for `--settings` carrying the resolved `enabledPlugins` map.
Generate the surviving MCP server set for `--mcp-config`, paired with `--strict-mcp-config`.
Refuse to launch, with an explanation, on any server config that cannot be faithfully
round-tripped — never guess.

Warn loudly when a workspace is untrusted: project-scope Components silently fail to load
until the trust prompt is accepted and `/reload-plugins` runs. Silent under-loading is the
worst possible failure for a tool whose job is controlling what loads.

## Phase 4 — Codex Projection

The same resolution, emitted as repeated `-c` overrides: `plugins."…".enabled`,
`skills.config`, and re-emitted `mcp_servers` entries. No profile file — that would be
persistent state in a directory we do not own, and would collide with the user's own profiles.

## Phase 5 — `adopt`

Walk the Inventory and write Annotations where the target client needs them. Idempotent,
`--dry-run`, and reversible with `--undo`. `doctor` reports drift, unannotated skills, and
identity collisions.

## Phase 6 — `run`

`plugdin run <client> [--loadout X] [native args…]`. Argument passthrough is a hard
requirement from day one: reserve `--loadout` and treat everything else as opaque. The moment
the wrapper cannot accept `-p` or `--model`, people stop using it. TUI picker when no Loadout
is named. Optional shell aliases shipped as an opt-in snippet.

## Out of scope for v1

GUI (it cannot set session-scoped state for a terminal the user launched, which would drag the
design back to the machine-scoped model ADR-0001 rejects). Cursor, OpenCode, Grok Build, Pi.
Mid-session toggling. Sub-server MCP granularity — tool, prompt, and resource level. Anything
resembling installation or a marketplace.

## Principal risks

1. **MCP round-trip fidelity.** The one place both clients force reconstruction rather than a
   toggle. Mitigated by refusing rather than guessing, and by `explain --diff`.
2. **Client drift.** Every mechanism is an implementation detail of a fast-moving vendor CLI.
   Mitigated by keeping Projection in one adapter per client and treating the Phase 0 probes
   as a regression suite to re-run against new client versions.
3. **Annotation is a fork risk if it outlives its purpose.** It is a shim for one client and
   should be deleted the day Claude Code reads the Agent Plugins root `plugin.json`.
