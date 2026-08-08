# S3 — does Codex `skills.config` replace or merge with the existing array?

`codex doctor --json` has no skills-visibility field (checked: `config.load` details list
feature flags and MCP server count, nothing about skills), so this isn't mechanically
answerable the way S5 was. Real answer needs a model-observed two-run diff:

```bash
# Baseline: ask what skills Codex can see, with no override.
codex exec "List the names of every skill available to you, one per line, nothing else."

# Overlay: disable exactly one currently-visible skill by name via -c, everything else untouched.
codex exec -c 'skills.config=[{name="<some-visible-skill>",enabled=false}]' \
  "List the names of every skill available to you, one per line, nothing else."
```

If every other previously-visible skill is still present in the second run, `skills.config`
merges by name rather than replacing the array — Projection (Phase 4) only needs to emit
entries for Components actually being turned off, not the full Inventory every launch. If
skills not mentioned in the override disappear, Projection must always enumerate the
complete Inventory.

Substitute `<some-visible-skill>` with a real skill name from the first run's output before
running the second command. Not run automatically — costs a small amount of real API usage.
