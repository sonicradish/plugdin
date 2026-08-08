# Usage guide

For how the pieces fit together internally, see [overview.md](./overview.md). This doc is
the practical reference: every command, every flag, exit codes, and the two ways to create a
Loadout.

## Install

```bash
npm install
npm run build      # compiles src/ -> dist/, which package.json's "bin" points at
```

During development you can skip the build step and run the TypeScript directly:

```bash
npx tsx src/cli.ts <command>
```

Every example below uses `plugged-in <command>`; substitute `npx tsx src/cli.ts <command>` if
you haven't built.

## `plugged-in explain [loadout]`

Read-only. Resolves a Loadout against the live Inventory and prints, for **both** Clients:
every discovered Component and whether it's on or off, the exact native launch args
Projection would produce, the exact generated config file contents, and any refusals. Writes
nothing to disk and launches nothing.

```bash
plugged-in explain              # uses the project default Loadout, else "all"
plugged-in explain dev          # explicitly name a Loadout
plugged-in explain none         # the built-in "everything off" baseline
```

Exit code: `0` if nothing was refused, `1` if at least one Component couldn't be faithfully
projected for at least one Client, `2` if the named Loadout doesn't exist.

Run this before `run` any time you're not sure what a Loadout will actually do — it's the
same resolution and Projection logic `run` uses, just without the last step.

## `plugged-in doctor`

Read-only. Reports:

- **Unannotated skills** — loose skills Claude Code can't filter yet (no `.claude-plugin/plugin.json` beside them).
- **Drifted Annotations** — an Annotation plugged-in wrote whose `name` no longer matches the skill's current name (e.g. after a rename, or `npx skills update` touching the skill).
- **Foreign Annotations** — a `.claude-plugin/plugin.json` that exists but wasn't written by plugged-in. Reported, never modified.
- **Identity collisions** — the same skill name found under both the global and project skill roots.
- **Dangling Loadout keys** — an `allow`/`deny` entry in any known Loadout that matches no Component in the *current* Inventory (almost always a typo, but can also mean "not installed here" for a portable global Loadout — the report can't tell those apart).

```bash
plugged-in doctor
```

Exit code: `0` if clean, `1` if anything above was found.

## `plugged-in adopt [--dry-run] [--undo]`

Writes (or removes) the Annotations `doctor` says are missing, for every discovered skill.

```bash
plugged-in adopt --dry-run   # show what would change, write nothing
plugged-in adopt             # actually write .claude-plugin/plugin.json beside each skill
plugged-in adopt --undo      # remove Annotations plugged-in wrote (idempotent, safe to re-run)
```

Guarantees:
- **Idempotent.** Running it twice in a row does nothing the second time (`already-annotated`).
- **Never touches a foreign Annotation**, forward or in reverse — if a `.claude-plugin/plugin.json` exists and wasn't written by plugged-in (no `pluggedIn` marker inside it), it's left alone and reported as skipped.
- **`--undo` only removes what it wrote.** It reads the marker before deleting anything.

Exit code: always `0` (it reports skips rather than failing on them).

## `plugged-in run <claude-code|codex> [--loadout NAME] [native args...]`

Resolves a Loadout, computes its Projection, and — if nothing was refused — execs the real
Client binary (`claude` or `codex`) with the Projection's args prepended to whatever you
passed after the client name. `--loadout` is the **only** flag this wrapper reserves;
everything else passes through untouched, in the order you gave it:

```bash
plugged-in run codex --loadout dev
plugged-in run claude-code --loadout dev -p "summarize this repo"
plugged-in run codex -p "hi" --loadout dev --model gpt-5.5   # --loadout can go anywhere
```

If a Projection has refusals, `run` prints them (same message `explain` would show) and exits
**without launching anything** — exit code `3`. Exit code `2` means the named Loadout doesn't
exist, or the first argument wasn't `claude-code`/`codex`. Otherwise the exit code is whatever
the Client itself exited with.

### No `--loadout` given

- **Interactively** (both stdin and stdout are a real terminal): shows a picker — see below.
- **Non-interactively** (piped, scripted, CI): silently uses the project's default Loadout
  (`.plugged-in/config.toml`'s `default_loadout`), or the built-in `all` baseline if the
  project declares none. Nothing prompts, nothing hangs waiting for input that isn't coming.

## Creating a Loadout

### Interactively (the picker)

Run `plugged-in run <client>` with no `--loadout`, in a real terminal. Every choice is a
real arrow-key menu (↑/↓ to move, Enter to confirm) — nothing to type except the name and,
in the toggle step, Space to flip an item:

```
? No --loadout given. Pick one: … 
❯ dev (project)
  all — everything on (native default)
  none — everything off
  Create a new Loadout...
```

Move down to "Create a new Loadout..." and press Enter:

```
? Name for the new Loadout › my-loadout
? Scope …
❯ project — .plugged-in/loadouts/ (committed, shared with the team)
  global — ~/.plugged-in/loadouts/ (just you, any project)
? Baseline …
  all — start with everything on, then deny what you don't want
❯ none — start with everything off, then allow what you want
  dev — inherit its resolved state
? Toggle Components (starting from the baseline's state): (space to toggle, enter to accept) …
❯ ◯ [skill] tdd@skills-dir
  ◯ [skill] code-review@skills-dir
  ...
```

The toggle list starts pre-checked exactly where the baseline you picked leaves each
Component (everything checked for `all`, nothing checked for `none`, or whatever an inherited
Loadout resolves to) — move with ↑/↓, press Space to flip the focused item, Enter when done.
The wizard writes the `.toml` file (see format below) — only the Components you actually
changed from the baseline end up in `allow`/`deny` — then immediately proceeds to launch the
Client with the Loadout you just built. There's no separate "save and quit" step.

A name must be letters/numbers/`-`/`_`/`.` only, and can't be `all` or `none` (those are
reserved, built-in baselines with no file). The wizard re-prompts on an invalid or
already-taken name rather than failing.

### By hand

A Loadout is a TOML file — nothing more. The filename (minus `.toml`) is its name; there's no
`name` field inside.

**Where:**
- `~/.plugged-in/loadouts/<name>.toml` — global, available in every project.
- `<project>/.plugged-in/loadouts/<name>.toml` — project-scoped, meant to be committed. A
  project file with the same name as a global one **replaces it outright** — they never
  merge, on purpose (a merged allow/deny set across scopes can't be debugged by reading one
  file).

**Format:**

```toml
baseline = "none"                              # "all", "none", or another Loadout's name
allow = ["tdd@skills-dir", "code-review@skills-dir"]
deny = []
```

- `baseline` defaults to `"all"` if omitted.
- Any string other than `"all"`/`"none"` is treated as a reference to another Loadout by
  name; chains resolve recursively and a cycle is a hard error.
- Listing the same key in both `allow` and `deny` is a hard error, not a silent tiebreak.
- Finding the right keys: run `plugged-in explain` or `plugged-in doctor` first — every
  discovered Component's exact key is printed there. Formats: `<name>@<marketplace>` for
  plugins and Annotated skills, `<name>@skills-dir` for any loose skill, and a
  `<binary-basename>-<hash>` fingerprint for MCP servers.

**Always verify a hand-written file** with `plugged-in explain <name>` before trusting it —
`doctor` also flags any `allow`/`deny` key that doesn't match a real Component (see above),
which is the most common way a hand-written file goes wrong.

### Project default

```toml
# <project>/.plugged-in/config.toml
default_loadout = "dev"
```

Only affects the non-interactive fallback and what the picker's menu implies as "the usual
choice" — it can't force a Loadout on anyone; `--loadout` and the interactive picker always
take priority.

## Worked example

```bash
plugged-in doctor                      # see what's unannotated
plugged-in adopt --dry-run             # preview what adopt would do about it
plugged-in adopt                       # write the Annotations for real
plugged-in explain dev                 # confirm the "dev" Loadout resolves the way you expect
plugged-in run claude-code --loadout dev -p "what does this repo do?"
```
