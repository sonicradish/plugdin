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

Every example below uses `pluggedin <command>`; substitute `npx tsx src/cli.ts <command>` if
you haven't built.

## `pluggedin explain [loadout]`

Read-only. Resolves a Loadout against the live Inventory and prints, for **both** Clients:
every discovered Component and whether it's on or off, the exact native launch args
Projection would produce, the exact generated config file contents, and any refusals. Writes
nothing to disk and launches nothing.

```bash
pluggedin explain              # uses the project default Loadout, else "all"
pluggedin explain dev          # explicitly name a Loadout
pluggedin explain none         # the built-in "everything off" baseline
```

Exit code: `0` if nothing was refused, `1` if at least one Component couldn't be faithfully
projected for at least one Client, `2` if the Loadout itself is unusable (doesn't exist,
references an unknown baseline, has a baseline cycle, lists the same key in both `allow` and
`deny`, or its TOML file fails to parse) — these print a one-line message, not a stack trace.

Run this before `run` any time you're not sure what a Loadout will actually do — it's the
same resolution and Projection logic `run` uses, just without the last step.

Every Component line is also labeled `(explicit)` or `(baseline default)` — `(explicit)`
means an `allow`/`deny` somewhere in this Loadout's baseline chain deliberately set that
Component's state; `(baseline default)` means it's just falling through to the chain's
terminal `all`/`none` untouched. This is the fast way to check "did my `allow`/`deny` list
actually do what I meant," instead of eyeballing the full roster against the TOML by hand.

A Component that couldn't be faithfully projected shows up as either `REFUSED` (blocks `run`
entirely — there's a real fix, usually `adopt`) or `NOTE` (non-blocking — `run` proceeds and
leaves the Component exactly as the Client's own config already has it; currently only
"turn an already-configured Codex MCP server off", which has no faithful mechanism at all, so
blocking forever would help no one).

## `pluggedin doctor`

Read-only. Reports:

- **Unannotated skills** — loose skills Claude Code can't filter yet (no `.claude-plugin/plugin.json` beside them). Only matters if you use Claude Code — Codex reads skills natively and needs no Annotation, so this line is safe to ignore on a Codex-only setup.
- **Drifted Annotations** — an Annotation pluggedin wrote whose `name` no longer matches the skill's current name (e.g. after a rename, or `npx skills update` touching the skill).
- **Foreign Annotations** — a `.claude-plugin/plugin.json` that exists but wasn't written by pluggedin. Reported, never modified.
- **Identity collisions** — the same skill name found under both the global and project skill roots.
- **Dangling Loadout keys** — an `allow`/`deny` entry in any known Loadout that matches no Component in the *current* Inventory (almost always a typo, but can also mean "not installed here" for a portable global Loadout — the report can't tell those apart).

```bash
pluggedin doctor
```

Exit code: `0` if clean, `1` if anything above was found, `2` if a Loadout file itself fails to
parse (same "print a message, not a stack trace" behavior as `explain`).

## `pluggedin adopt [--dry-run] [--undo]`

**Only needed if you use Claude Code.** Codex reads skills natively via `-c skills.config=[...]`
and needs no shim. Claude Code has no native skill filter at all, so a loose skill is *always*
visible to it regardless of Annotation — `adopt` only matters the moment a Claude Code Loadout
tries to turn a specific skill *off*; without an Annotation, Projection has no mechanism to
honor that and refuses instead (see `explain`'s REFUSED section). If you only run
`pluggedin run codex`, you can skip this command entirely.

Writes (or removes) the Annotations `doctor` says are missing, for every discovered skill.

```bash
pluggedin adopt --dry-run   # show what would change, write nothing
pluggedin adopt             # actually write .claude-plugin/plugin.json beside each skill
pluggedin adopt --undo      # remove Annotations pluggedin wrote (idempotent, safe to re-run)
```

Guarantees:
- **Idempotent.** Running it twice in a row does nothing the second time (`already-annotated`).
- **Never touches a foreign Annotation**, forward or in reverse — if a `.claude-plugin/plugin.json` exists and wasn't written by pluggedin (no `pluggedIn` marker inside it), it's left alone and reported as skipped.
- **`--undo` only removes what it wrote.** It reads the marker before deleting anything.

Exit code: always `0` (it reports skips rather than failing on them).

## `pluggedin run <claude-code|codex> [--loadout NAME] [native args...]`

Resolves a Loadout, computes its Projection, and — if nothing was refused — execs the real
Client binary (`claude` or `codex`) with the Projection's args prepended to whatever you
passed after the client name. `--loadout` is the **only** flag this wrapper reserves;
everything else passes through untouched, in the order you gave it:

```bash
pluggedin run codex --loadout dev
pluggedin run claude-code --loadout dev -p "summarize this repo"
pluggedin run codex -p "hi" --loadout dev --model gpt-5.5   # --loadout can go anywhere
```

If a Projection has refusals, `run` prints them (same message `explain` would show) and exits
**without launching anything** — exit code `3`. Exit code `2` means either the first argument
wasn't `claude-code`/`codex`, or the Loadout itself is unusable (same set of cases as
`explain`'s exit `2`: doesn't exist, unknown baseline, baseline cycle, an allow/deny
contradiction, or unparseable TOML) — nothing gets launched in either case. Otherwise the exit
code is whatever the Client itself exited with.

If a Projection only has *warnings* (currently: an already-configured Codex MCP server that
can't be faithfully turned off), `run` prints a `Note:` line to stderr for each one and then
launches anyway — the Component is simply left as the Client's own config already has it.

### No `--loadout` given

- **Interactively** (both stdin and stdout are a real terminal): shows a picker — see below.
- **Non-interactively** (piped, scripted, CI): uses the project's default Loadout
  (`.pluggedin/config.toml`'s `default_loadout`), or the built-in `all` baseline if the
  project declares none. Nothing prompts, nothing hangs waiting for input that isn't coming —
  but it isn't silent either: `pluggedin: no --loadout given; using "<name>"` goes to stderr
  before the Client launches, so a script's log always shows which Loadout actually ran.

## Creating a Loadout

### Interactively (the picker)

Run `pluggedin run <client>` with no `--loadout`, in a real terminal. Every choice is a
real arrow-key menu (↑/↓ to move, Enter to confirm) — nothing to type except the name and,
in the toggle step, Space to flip an item:

```
? No --loadout given. Pick one: … 
❯ dev (project)
  off (project) — ⚠ 3 refusals, see `explain`
  all — everything on (native default)
  none — everything off
  Create a new Loadout...
```

Each existing Loadout is resolved and projected before the menu is drawn, so one that would
refuse to launch (or whose TOML is itself broken — an unknown baseline, a cycle, an
allow/deny contradiction) is flagged right there, before you commit to it — not after, as a
wall of refusal text once `run` has already tried.

Move down to "Create a new Loadout..." and press Enter:

```
? Name for the new Loadout › my-loadout
? Scope …
❯ project — .pluggedin/loadouts/ (committed, shared with the team)
  global — ~/.pluggedin/loadouts/ (just you, any project)
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
- `~/.pluggedin/loadouts/<name>.toml` — global, available in every project.
- `<project>/.pluggedin/loadouts/<name>.toml` — project-scoped, meant to be committed. A
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
- Finding the right keys: run `pluggedin explain` or `pluggedin doctor` first — every
  discovered Component's exact key is printed there. Formats: `<name>@<marketplace>` for
  plugins and Annotated skills, `<name>@skills-dir` for any loose skill, and a
  `<binary-basename>-<hash>` fingerprint for MCP servers.

**Always verify a hand-written file** with `pluggedin explain <name>` before trusting it —
`doctor` also flags any `allow`/`deny` key that doesn't match a real Component (see above),
which is the most common way a hand-written file goes wrong.

### Project default

```toml
# <project>/.pluggedin/config.toml
default_loadout = "dev"
```

Only affects the non-interactive fallback and what the picker's menu implies as "the usual
choice" — it can't force a Loadout on anyone; `--loadout` and the interactive picker always
take priority.

## Worked example

```bash
pluggedin doctor                      # see what's unannotated
pluggedin adopt --dry-run             # preview what adopt would do about it
pluggedin adopt                       # write the Annotations for real
pluggedin explain dev                 # confirm the "dev" Loadout resolves the way you expect
pluggedin run claude-code --loadout dev -p "what does this repo do?"
```
