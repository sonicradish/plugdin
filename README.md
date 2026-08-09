# pluggedin

Decides which plugins, skills, and MCP servers appear to a coding agent in a given session,
and makes that decision reusable and portable across agent clients (Claude Code, Codex,
Grok Build, OpenCode, Pi).

Start with [PLAN.md](./PLAN.md) for the build plan and [CONTEXT.md](./CONTEXT.md) for
vocabulary. Settled architecture is in [docs/adr/](./docs/adr/). [spikes/](./spikes/) has the
Phase 0 empirical probes and [spikes/FINDINGS.md](./spikes/FINDINGS.md) their results.

- **[docs/overview.md](./docs/overview.md)** — how it all fits together: the discovery →
  resolution → Projection → Activation pipeline, per-Client mechanics, where a decision
  actually lives on disk.
- **[docs/usage.md](./docs/usage.md)** — the full command reference: every flag, exit codes,
  and both ways to create a Loadout (the interactive picker and by hand).

## Setup

```bash
npm install
npm run build     # compiles src/ -> dist/, which package.json's bin points at
```

## Usage summary

```bash
pluggedin explain [loadout]                        # read-only: preview a Loadout, no I/O
pluggedin doctor                                    # read-only: Annotation drift, collisions
pluggedin adopt [--dry-run] [--undo]                 # only needed for Claude Code support
pluggedin run <claude|codex|grok|opencode|pi> [--loadout X] [native args...]
                                                      # launches with --loadout omitted:
                                                      #   TTY  -> interactive picker/creator
                                                      #   else -> project default, else "all"
```

During development, run any of these against the TypeScript source directly instead of
rebuilding:

```bash
npx tsx src/cli.ts explain
```

A Loadout is a TOML file under `~/.pluggedin/loadouts/<name>.toml` (global) or
`.pluggedin/loadouts/<name>.toml` (project — see `.pluggedin/loadouts/dev.toml` in this
repo for a real example). Project Loadouts override global ones by name, never merge. See
[docs/usage.md](./docs/usage.md#creating-a-loadout) for the full format and the interactive
alternative.

## Development

```bash
npm test          # vitest
npm run typecheck # tsc, both src/ and test/
```

Tests that need real Client behavior mock `runClientCommand` (`src/util/exec.ts`) rather than
shelling out — the actual shapes of `claude plugin list --json` / `grok inspect --json` /
`opencode debug skill` etc. were captured live against this machine's real Client installs and are
documented where each adapter parses them (`src/inventory/*.ts`) and in
`spikes/FINDINGS.md`.

## Status

All six phases in PLAN.md have working code and test coverage: Inventory discovery, `explain`,
the Loadout/Baseline resolution model, per-Client Projection, `adopt`/`doctor`, and
`run`. Known gaps, tracked in code comments and `spikes/FINDINGS.md`:

- Claude Code's populated `plugin list --json` shape is inferred, not confirmed (empty-array
  case is confirmed) — `claude plugin install` was blocked by the auto-mode permission
  classifier while building this. Verify before trusting `explain` output for a non-empty
  plugin Inventory.
- Claude Code plugin-provided MCP servers aren't discovered yet (only `.mcp.json` and
  `~/.claude.json`-registered servers are).
- S2 (does `--strict-mcp-config` suppress plugin MCP servers) and S3 (does Codex
  `skills.config` merge or replace) are unresolved — Phase 3/4 are built conservatively
  against either answer, but resolving them would let Projection emit less.
