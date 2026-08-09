# plugdin

Decides which plugins, skills, and MCP servers appear to a coding agent in a given session,
and makes that decision reusable and portable across agent clients (Claude Code, Codex,
Grok Build, OpenCode, Pi).

## Setup

No install needed — `npx` fetches and runs it:

```bash
npx plugdin explain
```

Or install it once so `plugdin` is on your PATH:

```bash
npm install -g plugdin
```

To work on plugdin itself, build from source instead:

```bash
npm install
npm run build     # compiles src/ -> dist/, which package.json's bin points at
```

## Usage summary

```bash
plugdin explain [loadout]                        # read-only: preview a Loadout, no I/O
plugdin doctor                                    # read-only: Annotation drift, collisions
plugdin adopt [--dry-run] [--undo]                 # only needed for Claude Code support
plugdin run <claude|codex|grok|opencode|pi> [--loadout X] [native args...]
                                                      # launches with --loadout omitted:
                                                      #   TTY  -> interactive picker/creator
                                                      #   else -> project default, else "all"
```

During development, run any of these against the TypeScript source directly instead of
rebuilding:

```bash
npx tsx src/cli.ts explain
```

A Loadout is a TOML file under `~/.plugdin/loadouts/<name>.toml` (global) or
`.plugdin/loadouts/<name>.toml` (project — see `.plugdin/loadouts/dev.toml` in this
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
