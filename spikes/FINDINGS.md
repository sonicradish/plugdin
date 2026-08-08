# Phase 0 spike findings

Run against Claude Code and Codex CLI 0.147.0 in this environment on 2026-08-08.

## Resolved this session

**S5 — large Inventory vs. `-c` argument list: does not invalidate the design.**
5000 synthetic `plugins."…".enabled=false` overrides (10,000 argv entries) parsed cleanly
via `codex doctor --summary`, well under `ARG_MAX` (1,048,576 bytes on this machine — see
`s5-arg-list-size.sh`). A `-c`-only Projection is safe at any realistic Inventory size;
Phase 4 does not need a profile-file fallback for this reason. Ran, no side effects.

**New: both Clients expose free, mechanical introspection — use it for Inventory, not
config-file parsing.**
Not one of the original S1-S5 questions, but discovered while probing S1: both Clients have
first-class commands for exactly what Phase 1 (Inventory) needs, and they're read-only, make
no model/API call, and don't require re-implementing each vendor's config-resolution logic:

| Data | Claude Code | Codex |
|---|---|---|
| Plugins | `claude plugin list --json` | `codex plugin list --json` |
| MCP servers | `claude mcp list` | `codex mcp list` |
| Local health/config | `claude doctor` | `codex doctor --json` |

This changes Phase 1's implementation plan: adapters should shell out to these rather than
hand-parse `settings.json` / `config.toml`, which reduces exposure to the "Client drift"
principal risk (PLAN.md) since vendor-side resolution logic (marketplace merging, etc.) is
then the vendor's problem, not ours, for *discovery*. Projection (Phase 3/4) still has to
author `--settings` / `-c` payloads directly, since that's the surface being tested.

**New: `~/.claude/skills/` is a symlink farm into `~/.agents/skills/`.**
Discovered while building Phase 1: every entry under `~/.claude/skills/` in this environment
is a symlink to `../../.agents/skills/<name>`. `fs.readdir(..., {withFileTypes:true})`
reports a symlink's own dirent type, not its target's — `entry.isDirectory()` is `false` for
all of them, so naive directory-walking silently discovers zero skills. Fixed by `stat`-ing
each entry (which follows symlinks) instead. Also means `~/.agents/skills/` is itself a
second real shared root — worth confirming later whether Codex reads `~/.claude/skills/` (as
PLAN.md's existing note assumes) or `~/.agents/skills/` directly; either way they currently
resolve to the same files here, so it hasn't mattered yet.

**New: real `codex plugin list --json` and `codex mcp list --json` shapes captured.**
Not a spike question, but load-bearing for Phase 1. Recorded in
`src/inventory/codex.ts` doc comments; summary: plugin list is `{"installed": [{pluginId,
name, marketplaceName, installed, enabled, source:{path}}]}` (NOT a flat array — an earlier
guess assumed flat and silently produced zero components against the real shape until
caught by a live smoke run), MCP list is a flat array of `{name, transport:{command, args,
env}}`.

## Partially resolved

**S1 — allowlist vs. per-key override.** `claude plugin list --json` only reflects
*installed* plugins; passing `enabledPlugins: {"X@marketplace": true}` for a plugin that is
merely present in a registered marketplace, but not installed, does not make it appear
(`s1-enabled-plugins.sh`, run 2026-08-08 — all three probes returned `[]`, since no plugin is
installed in this environment). Installing a real plugin to finish this test mutates shared
machine state (`~/.claude/plugins` or the project's plugin registration) outside what a
read-only spike should do without sign-off, so the allowlist-vs-override question itself is
still open. Re-run `s1-enabled-plugins.sh` after `claude plugin install
code-review@claude-plugins-official` (and `... commit-commands@claude-plugins-official`) —
expect to `claude plugin uninstall` both afterward to leave the machine as found.

## Deferred — need a live model-observed run

These need "what does the model report it can see," which costs real API usage and, for S2,
a plugin that declares an MCP server (none currently installed here). Scripts/exact commands
are written and ready:

- **S2** (`s2-strict-mcp-config.md`) — does `--strict-mcp-config` suppress plugin-provided
  MCP servers too? Directly affects whether Phase 3 must re-emit plugin MCP servers
  explicitly.
- **S3** (`s3-codex-skills-config.md`) — does Codex `skills.config` merge or replace? Affects
  whether Phase 4 must always enumerate the full Inventory.
- **S4** (`s4-annotation-survival.md`) — does `npx skills update` clobber an Annotation? Needs
  Phase 5 (`adopt`) to exist first to have an Annotation to threaten; re-run then.

None of these block starting Phase 1 (read-only Inventory/`explain`), which is why the plan
sequences Phase 1 before Projection is load-bearing. They do block shipping Phase 3/4 with
confidence — `explain --diff` (Phase 1) is what makes that gap visible to a user before they
trust a launch, per PLAN.md's Principal risk #1.
