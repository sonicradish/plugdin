# Phase 0 spikes

Each spike is a two-run probe: run a script with a baseline config, then with one thing
changed, and diff what the target Client reports. Run from repo root. None of these mutate
`~/.claude` or `~/.codex` — every probe goes through session flags (`--settings`,
`--mcp-config`, `-c`), never through real config files, per ADR-0001.

## Mechanical vs. model-observed

Two ways to answer "what does the Client actually load":

1. **Mechanical** — shell out to the Client's own introspection commands
   (`claude plugin list --json`, `claude mcp list`, `codex plugin list --json`,
   `codex mcp list`, `codex doctor --json`). Free, fast, no model turn. Answers questions
   about config resolution.
2. **Model-observed** — run `claude -p` / `codex exec` with a short prompt asking the model
   to enumerate what it can see, and diff the two runs. Costs a small amount of real API
   usage against the operator's account. Required for anything about context visibility
   specifically (e.g. "did this leave the model's context, not just get blocked at the
   permission layer" — the distinction PLAN.md's "context optimization" goal turns on).

Spikes below are written to prefer (1). Where only (2) can answer the question, the script
is provided but not wired into CI or run automatically — run it by hand when you want to
spend the tokens.

## S1 — `enabledPlugins`: allowlist or override?

`s1-enabled-plugins.sh`. Mechanical, via `claude plugin list --json` under two `--settings`
overlays.

## S2 — does `--strict-mcp-config` also suppress plugin-provided MCP servers?

`s2-strict-mcp-config.md`. Requires a plugin that itself declares an MCP server, run with and
without `--strict-mcp-config`, then `claude mcp list` inside that session (mechanical) — but
`claude mcp list` is a separate CLI invocation, not observable *inside* a running session, so
this needs the model-observed path: ask the model to list its available MCP tool names.
Not run automatically; see the file for the exact two commands.

## S3 — does Codex `skills.config` replace or merge with the existing array?

`s3-codex-skills-config.sh`. Mechanical: set `skills.config` via `-c` to a single-entry array
naming a skill Codex would not otherwise know about, then `codex doctor --json` and check
`config.load` — doesn't directly show it. Real answer needs `codex exec` with a
"list your skills" prompt (model-observed). Script scaffolds both.

## S4 — does `npx skills update` preserve or clobber an Annotation?

`s4-annotation-survival.md`. Out of scope to automate against a real installed skill package
right now (no local `npx skills`-managed skill in this environment to update against).
Documented procedure only; re-run once Phase 5 (`adopt`) exists and there's an Annotation to
threaten.

## S5 — does a large Inventory blow the `-c` argument list on Codex?

`s5-arg-list-size.sh`. Purely mechanical and safe: construct a large `-c` argument list and
confirm Codex parses it without spawning a model turn (`codex doctor` reads config but makes
no API call).
