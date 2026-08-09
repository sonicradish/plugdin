# How plugdin works

This is the "how it fits together" doc. For *why* it's built this way, see
[../docs/adr/](./adr/). For the exact meaning of each term, see
[../CONTEXT.md](../CONTEXT.md) — this doc uses that vocabulary without re-defining it, except
for a quick refresher below.

## The problem, in one sentence

Agent Plugins v1 standardizes how a plugin is *packaged*; it leaves "which of my installed
extensions is active in this particular session" entirely to each client. plugdin supplies
that missing, portable decision.

## Vocabulary refresher

| Term | Meaning |
|---|---|
| **Component** | One governable thing: a plugin, a skill, or an MCP server. |
| **Client** | A runtime that loads Components — Claude Code, Codex, Grok Build, OpenCode, or Pi. |
| **Inventory** | Every Component discovered on the machine, across every Client. |
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
introspection commands (`claude plugin list --json`, `codex mcp list --json`,
`grok inspect --json`, `opencode debug skill`, `pi list`) rather than re-parsing
`settings.json`/`config.toml` by hand — that way marketplace/config-merging logic stays the
vendor's problem, not ours (see `spikes/FINDINGS.md`). Skills in the shared roots
(`~/.claude/skills/`, `<project>/.claude/skills/`) are walked directly, since Claude Code and
Codex have no "list skills" command; a skill found there is reported as visible to every
Client that reads those roots — Claude Code, Codex, Grok, and OpenCode, but not Pi, which
scans only its own (a fact this tool relies on, not one it created).

The same skill often arrives from several Clients at once, spelled differently: Claude Code
names it by the `~/.claude/skills/` path it was found under, Grok by the
`~/.agents/skills/` file that symlink resolves to. `index.ts` reconciles those into one
Component by comparing *real* paths, so `tdd@skills-dir` means one decision everywhere it
appears — while a Pi package that merely shares a name with it stays a separate Component,
because it is a separate file.

**2. Loadout resolution** (`src/loadout/resolve.ts`) — Pure function:
`(Loadout, Inventory, all-known-Loadouts) → Resolution`. Starts from the Loadout's Baseline
(recursively resolving through a chain of `baseline: <other loadout>` references, erroring on
a cycle) and applies `allow`/`deny` on top. Because it resolves against the *live* Inventory
every time rather than a snapshot, a `baseline: all` Loadout automatically picks up a newly
installed Component; a `baseline: none` one does not.

**3. Projection** (`src/projection/`, one file per Client behind the `projectFor` registry in
`index.ts`) — Turns a Resolution into what each Client actually understands, generated fresh
per session and never written to the Client's own config. A Projection reaches its Client by
one of three routes (ADR-0001, ADR-0005) — launch `args`, an `env` overlay, or an ephemeral
config-home `mirror`:

- **Claude Code**: an `enabledPlugins` map for `--settings`, and the surviving MCP server set
  for `--mcp-config` + `--strict-mcp-config`.
- **Codex**: repeated `-c plugins."<key>".enabled=<bool>` overrides, plus one
  `-c skills.config=[...]` override listing every skill (not just the changed ones — see
  below).
- **Grok Build**: a generated `config.toml` inside an ephemeral `GROK_HOME` whose every other
  entry is a symlink to the real `~/.grok`, so credentials and sessions survive.
- **OpenCode**: one inline JSON config layer in `OPENCODE_CONFIG_CONTENT`, merged last.
- **Pi**: native allowlist flags only — `--no-skills` / `--no-extensions` plus a `--skill` or
  `--extension` path per survivor. No files, no environment.

Projection is a pure function: anything it needs off disk (Grok's existing `config.toml`) is
read by the caller first, so `explain` can preview a launch without touching the filesystem.

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

A Projection can also carry **notes**: not a gap at all, but a remark about *how* a decision
was enforced where the mechanism differs from "the Component is simply not there". OpenCode
has no per-skill discovery filter, so a skill turned off is denied through its `skill`
permission — it cannot run, but its name stays in the model's catalog. That is projected, not
warned about, and stated rather than left to be discovered (ADR-0005).

**4. Activation** (`src/commands/run.ts`) — Materializes the Projection's generated files and
config-home mirrors to a fresh temp directory (nothing under the Client's own config
directories is ever modified) and execs the native Client with the Projection's args
prepended to whatever passthrough args the user gave, and its environment overlaid on the
inherited one. If the Projection has any refusals, `run` stops before spawning anything;
warnings and notes print to stderr first but never block.

`explain` (`src/commands/explain.ts`) runs stages 1–3 and prints the result; it never reaches
stage 4, so it has zero side effects — useful specifically because every stage above it is an
indirection between what the user asked for and what the Client actually sees, and that gap
needs to be inspectable before it's trusted.

## Per-Client mechanics, at a glance

Five Clients, and no two deliver a Projection the same way. How each one is *reached* first:

| Client | Binary | Discovery | Projection arrives as |
|---|---|---|---|
| Claude Code | `claude` | `claude plugin list --json`, config files | `--settings` + `--mcp-config` flags |
| Codex | `codex` | `codex plugin list --json`, `codex mcp list --json` | repeated `-c key=value` flags |
| Grok Build | `grok` | `grok inspect --json` (skills, plugins, MCP in one call), `grok mcp list --json` | an ephemeral `GROK_HOME` (ADR-0005) |
| OpenCode | `opencode` | `opencode debug skill`, `opencode debug config` | `OPENCODE_CONFIG_CONTENT` env var (ADR-0005) |
| Pi | `pi` | `pi list` + each package's `package.json` `pi` field | native `--no-skills` / `--skill` allowlist flags |

And what each can actually do with a Component:

| | Claude Code | Codex | Grok Build | OpenCode | Pi |
|---|---|---|---|---|---|
| Plugins | `enabledPlugins` map via `--settings` | `-c plugins."name@marketplace".enabled=false` | `[plugins] disabled` (documented, unverified — nothing installed to test) | only if *every* plugin is off (`plugin: []`); a partial set warns | packages, via `--no-extensions` + `--extension <path>` |
| Skills | No native filter → Annotation makes a skill load as `<name>@skills-dir`, then `enabledPlugins` filters it | `skills.config` via `-c`, natively | `[skills] ignore`, by path | denied via the `skill` permission — cannot run, but stays listed (a Projection note says so) | `--no-skills` + `--skill <path>` |
| MCP servers | `--mcp-config` (full surviving set) + `--strict-mcp-config` | Turning one *off* has no faithful mechanism (warns, leaves it on) | `[mcp_servers.<n>] enabled`, if the user layer defines it; a project-layer server warns | `mcp.<n>.enabled = false` | No mechanism — Pi's MCP comes from an extension whose layers merge (warns) |
| Annotation needed? | Yes, for loose skills | No | No | No | No |

Identity is the same everywhere: `name@marketplace` for plugins and Annotated skills, a
command+args fingerprint for MCP servers. Skills carry a per-Client suffix where a Client
has its own copy (`@grok-skills`, `@opencode-skills`, `@pi-skills`) — but a skill several
Clients read from the *same file* is one Component, reconciled by real path, so turning
`tdd@skills-dir` off turns it off everywhere at once.

Everything here is empirically verified against a real install, not read from vendor docs —
see the "Verified foundations" table in `PLAN.md` and `spikes/FINDINGS.md` for exactly what
was run and when. These are fast-moving vendor CLIs; if behavior seems to have drifted,
`spikes/` has the probes to re-run.

## Where a decision lives, on disk

- **A Loadout** is a TOML file — nothing else. `~/.plugdin/loadouts/<name>.toml` (global)
  or `<project>/.plugdin/loadouts/<name>.toml` (project). Same name in both places → the
  project one wins outright; they never merge.
- **A project's default Loadout** (used when `run` is invoked with no `--loadout` and no one
  around to ask) is one line in `<project>/.plugdin/config.toml`: `default_loadout = "x"`.
  A project can suggest a default; it can't force one — `all` is the fallback if it declares
  nothing.
- **An Annotation** lives inside the skill's own directory,
  `<skill>/.claude-plugin/plugin.json`, tagged with a `plugdin` marker so `adopt`/`doctor`
  can tell a plugdin-managed Annotation from one a human or another tool wrote by hand —
  the latter is never touched, in either direction.
- **Nothing else is persistent.** Projection's generated files, and the ephemeral config
  home Grok is launched with, live under a fresh `os.tmpdir()` directory per `run`
  invocation and are never reused across sessions. The mirror inside it is symlinks into
  `~/.grok`, so the Client's own writes during the session still reach the user's real
  files (ADR-0005).

## Code map

```
src/domain/types.ts        the vocabulary above, as TypeScript types
src/inventory/              stage 1 — discovery, one file per Client (claude-code.ts, codex.ts,
                              grok.ts, opencode.ts, pi.ts) plus skills.ts and mcp-json.ts for
                              the roots and file formats several Clients share; index.ts
                              reconciles a skill two Clients both see into one Component
src/loadout/                stage 2 — resolve.ts (pure), store.ts (read TOML), write.ts (write TOML)
src/projection/              stage 3 — one file per Client, index.ts (the registry every command
                              dispatches through), materialize.ts (writes files and mirrors)
src/adopt/                  Annotation read/write/plan/apply (adopt, doctor)
src/tui/                    the interactive Loadout picker's I/O layer
src/commands/                one file per CLI command, thin orchestration over the above
src/cli.ts                  argv parsing and dispatch — no logic of its own
```

Every stage above `src/cli.ts` is unit-tested without a real Client installed, by mocking
`runClientCommand` (`src/util/exec.ts`) with the real JSON shapes captured live against this
machine's Client installs. See `docs/usage.md` for how to actually run the thing.
