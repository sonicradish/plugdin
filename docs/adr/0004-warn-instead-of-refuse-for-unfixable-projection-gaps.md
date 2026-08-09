# Warn, don't refuse, when a Projection gap has no available fix

`Projection` now reports two different kinds of "this Component could not be faithfully
projected": `refusals`, which block `run` entirely, and `warnings`, which print to stderr (and
show as `NOTE` in `explain`) but let launch proceed, leaving the Component exactly as the
Client's own config already has it. Previously every such gap was a refusal.

The split test is narrow: **does a fix exist through this tool?** Turning off an unannotated
skill for Claude Code refuses, because `adopt` actually resolves it — the user can act, so
it's worth stopping them until they do. Turning off an already-configured Codex MCP server
warns instead, because no mechanism exists to do that faithfully at all (Codex's
`mcp_servers.<n>` entry has no bare toggle, and re-emitting the entry loses fields this tool
never captured — see PLAN.md's "Verified foundations" and `spikes/FINDINGS.md`). Refusing a
gap nobody can close doesn't protect anything; it just forces every Loadout that targets
Codex to explicitly `allow` every MCP server the user already configured, forever, to get
past a block that was never going anywhere.

## Why this does not contradict "refuse rather than guess"

The principle (PLAN.md, Principal risk #1) is that Projection must never silently misrepresent
what's active. A warning does not violate that: it is printed, not swallowed — `run` and
`explain` both surface it unconditionally, the same as a refusal, just without stopping
launch. What changed is *when a printed gap should also block*, not whether a gap gets
reported. Blocking is the tool's leverage to get a user to fix something; where there is
nothing to fix, blocking has no leverage left to spend, only friction.

## Considered Options

- **Keep it a hard refusal indefinitely** — rejected: since no fix can ever close it, this
  is not a temporary block pending user action, it's a permanent one. The only way past it
  is `allow`-ing the Component explicitly in every affected Loadout, which just re-encodes
  "leave it as Codex already has it" — the exact behavior a warning now expresses directly.
- **Drop the gap silently (no message at all)** — rejected outright: contradicts the tool's
  entire premise. The person launching must always be able to see where a Loadout's stated
  intent and the Client's actual state diverge, whether or not launch is blocked.
- **A `--force`/`--ignore-refusals` flag to bypass any refusal** — rejected: it doesn't
  distinguish fixable from unfixable gaps, so it would let a user bypass a *fixable* Claude
  Code refusal too (e.g. forgetting to run `adopt`), silently shipping the exact
  misrepresentation refusing exists to prevent. The warning/refusal split makes that
  distinction structurally, per-gap, instead of leaving it to whoever remembers to pass a flag.

## Consequences

`Projection` carries `warnings: readonly Refusal[]` alongside `refusals` (same shape,
different handling). `execRun` and `explain`'s exit code only look at `refusals`; a
Loadout with only warnings exits `0`. If a second permanently unfixable gap ever surfaces,
it should be classified as a warning by the same test used here — "is there anything a user
could do, through this tool, to close it" — not by how alarming the gap sounds.
