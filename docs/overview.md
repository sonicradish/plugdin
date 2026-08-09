# How pluggedin works

This is the "how it fits together" doc. For *why* it's built this way, see
[../docs/adr/](./adr/). For the exact meaning of each term, see
[../CONTEXT.md](../CONTEXT.md) — this doc uses that vocabulary without re-defining it, except
for a quick refresher below.

## The problem, in one sentence

Agent Plugins v1 standardizes how a plugin is *packaged*; it leaves "which of my installed
extensions is active in this particular session" entirely to each client. pluggedin supplies
that missing, portable decision.

## Vocabulary refresher

| Term | Meaning |
|---|---|
| **Component** | One governable thing: a plugin, a skill, or an MCP server. |
| **Client** | A runtime that loads Components — Claude Code or Codex. |
| **Inventory** | Every Component discovered on the machine, across both Clients. |
| **Loadout** | A named, reusable on/off decision: a Baseline plus `allow`/`deny` deltas. |
| **Baseline** | What a Loadout starts from: `all`, `none`, or another Loadout by name. |
| **Resolution** | The result of resolving a Loadout against a live Inventory — a concrete on/off decision for every discovered Component. |
| **Activation** | A Resolution bound to one Client, for one session. |
| **Projection** | The native config/flags a specific Client needs to realize an Activation. |
| **Annotation** | A `.claude-plugin/plugin.json` shim beside a skill, so Claude Code (which has no native skill filter) can address it at all. |

## The pipeline

Every command in this tool is a stage (or a composition of stages) in the same pipeline:

```
Inventory discovery  →  Loadout resolution  →  Projection  →  Activation (run)
      (read-only)          (pure function)      (per-Client)    (spawns the Client)
```

**1. Inventory discovery** (`src/inventory/`) — Read-only. Shells out to each Client's own
introspection commands (`claude plugin list --json`, `codex plugin list --json`,
`codex mcp list --json`) rather than re-parsing `settings.json`/`config.toml` by hand — that
way marketplace/config-merging logic stays the vendor's problem, not ours (see
`spikes/FINDINGS.md`). Skills are discovered by walking `~/.claude/skills/` and
`<project>/.claude/skills/` directly, since neither Client has a "list skills" command; a
skill found there is reported as visible to *both* Clients (Codex already reads that same
directory — a fact this tool relies on, not one it created).

**2. Loadout resolution** (`src/loadout/resolve.ts`) — Pure function:
`(Loadout, Inventory, all-known-Loadouts) → Resolution`. Starts from the Loadout's Baseline
(recursively resolving through a chain of `baseline: <other loadout>` references, erroring on
a cycle) and applies `allow`/`deny` on top. Because it resolves against the *live* Inventory
every time rather than a snapshot, a `baseline: all` Loadout automatically picks up a newly
installed Component; a `baseline: none` one does not.

**3. Projection** (`src/projection/claude-code.ts`, `src/projection/codex.ts`) — Turns a
Resolution into what each Client actually understands, generated fresh per session and never
written to the Client's own config:

- **Claude Code**: an `enabledPlugins` map for `--settings`, and the surviving MCP server set
  for `--mcp-config` + `--strict-mcp-config`.
- **Codex**: repeated `-c plugins."<key>".enabled=<bool>` overrides, plus one
  `-c skills.config=[...]` override listing every skill (not just the changed ones — see
  below).

Projection can **refuse** instead of guessing, and separately can **warn** — the same
underlying gap (a Component can't be faithfully turned to the state a Loadout wants), but two
different responses depending on whether there's anything a caller could actually *do* about
it:

- **Refuses (blocks launch):** turning an *unannotated* skill off for Claude Code — there's no
  native filter for it, so honoring the request would require silently doing nothing, which
  contradicts the point of the tool. There's a real fix (`adopt`), so it's worth stopping for.
- **Warns (non-blocking — launch proceeds, the Component is left as the Client's own config
  already has it):** turning an already-configured Codex MCP server off — the only mechanism
  found requires re-emitting its full config struct, which this tool only captures a subset of
  fields for (command/args/env). Unlike the Claude Code case, there is no fix available
  *through this tool* — the gap is permanent, not actionable — so blocking every launch
  forever would just force every Loadout to explicitly `allow` every pre-existing Codex MCP
  server. `explain` still surfaces it (as `NOTE`, not `REFUSED`) so it's never silent. See
  `spikes/FINDINGS.md` and the "Verified foundations" table in `PLAN.md`.

**4. Activation** (`src/commands/run.ts`) — Materializes the Projection's generated files to
a fresh temp directory (nothing under the Client's own config directories is ever touched)
and execs the native Client with the Projection's args prepended to whatever passthrough args
the user gave. If the Projection has any refusals, `run` stops before spawning anything;
warnings print to stderr first but never block.

`explain` (`src/commands/explain.ts`) runs stages 1–3 and prints the result; it never reaches
stage 4, so it has zero side effects — useful specifically because every stage above it is an
indirection between what the user asked for and what the Client actually sees, and that gap
needs to be inspectable before it's trusted.

## Per-Client mechanics, at a glance

| | Claude Code | Codex |
|---|---|---|
| Plugins | `enabledPlugins` map via `--settings` | `-c plugins."name@marketplace".enabled=false` |
| Loose skills | No native filter → Annotation (`.claude-plugin/plugin.json`) makes a skill load as `<name>@skills-dir`, then `enabledPlugins` filters it like any plugin | `skills.config` via `-c`, natively — no Annotation needed |
| MCP servers | `--mcp-config` (full surviving set) + `--strict-mcp-config` | Turning one *off* has no verified faithful mechanism (Projection warns, non-blocking, and leaves it on) |
| Identity | `name@marketplace` (plugins, Annotated skills); a command+args fingerprint (MCP servers) | Same |

Everything here is empirically verified against a real install, not read from vendor docs —
see the "Verified foundations" table in `PLAN.md` and `spikes/FINDINGS.md` for exactly what
was run and when. Both are fast-moving vendor CLIs; if behavior seems to have drifted,
`spikes/` has the probes to re-run.

## Where a decision lives, on disk

- **A Loadout** is a TOML file — nothing else. `~/.pluggedin/loadouts/<name>.toml` (global)
  or `<project>/.pluggedin/loadouts/<name>.toml` (project). Same name in both places → the
  project one wins outright; they never merge.
- **A project's default Loadout** (used when `run` is invoked with no `--loadout` and no one
  around to ask) is one line in `<project>/.pluggedin/config.toml`: `default_loadout = "x"`.
  A project can suggest a default; it can't force one — `all` is the fallback if it declares
  nothing.
- **An Annotation** lives inside the skill's own directory,
  `<skill>/.claude-plugin/plugin.json`, tagged with a `pluggedIn` marker so `adopt`/`doctor`
  can tell a pluggedin-managed Annotation from one a human or another tool wrote by hand —
  the latter is never touched, in either direction.
- **Nothing else is persistent.** Projection's generated files live under a fresh
  `os.tmpdir()` directory per `run` invocation and are never reused across sessions.

## Code map

```
src/domain/types.ts        the vocabulary above, as TypeScript types
src/inventory/              stage 1 — discovery (claude-code.ts, codex.ts, skills.ts)
src/loadout/                stage 2 — resolve.ts (pure), store.ts (read TOML), write.ts (write TOML)
src/projection/              stage 3 — claude-code.ts, codex.ts, materialize.ts (writes to disk)
src/adopt/                  Annotation read/write/plan/apply (adopt, doctor)
src/tui/                    the interactive Loadout picker's I/O layer
src/commands/                one file per CLI command, thin orchestration over the above
src/cli.ts                  argv parsing and dispatch — no logic of its own
```

Every stage above `src/cli.ts` is unit-tested without a real Client installed, by mocking
`runClientCommand` (`src/util/exec.ts`) with the real JSON shapes captured live against this
machine's Claude Code/Codex installs. See `docs/usage.md` for how to actually run the thing.
