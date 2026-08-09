# S4 — does `npx skills update` preserve or clobber an Annotation?

Needs a skill actually installed and managed by `npx skills` (i.e. it has an update path)
plus a written Annotation (`.claude-plugin/plugin.json` beside it) to threaten. Neither
exists yet in this environment — the skills under `~/.claude/skills/` here were not
installed via `npx skills`, and Phase 5 (`adopt`, which writes Annotations) isn't built yet.

Procedure, once both preconditions exist:

```bash
# 1. Annotate a real npx-skills-managed skill (via `plugdin adopt` once it exists, or by
#    hand: write ~/.claude/skills/<name>/.claude-plugin/plugin.json).
cat ~/.claude/skills/<name>/.claude-plugin/plugin.json   # capture before-state

# 2. Update it through the tool that owns installation.
npx skills update <name>

# 3. Check whether the Annotation survived.
cat ~/.claude/skills/<name>/.claude-plugin/plugin.json   # compare to before-state
# or: ls ~/.claude/skills/<name>/.claude-plugin/  (missing entirely -> clobbered)
```

If clobbered, `plugdin doctor` (Phase 5) must detect this as drift and `adopt` must be
safe to re-run idempotently — already a stated requirement, so this spike is a
confirmation, not a design-invalidator either way. Re-run once `adopt` exists.
