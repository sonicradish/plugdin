# Annotate skills only for Clients that cannot address them

Claude Code has no setting that filters a loose skill, so plugged-in writes
`.claude-plugin/plugin.json` beside each installed skill; the folder then loads as a plugin
named `<skill>@skills-dir` that `enabledPlugins` filters at the discovery level. Codex needs
no such shim — `skills.config = [{ name = "…", enabled = false }]` removes a skill from
context natively. Annotation is therefore per-Client and applied only where required.

## Why this does not contradict ADR-0001

ADR-0001 forbids mutating Client state to express *activation*. Annotation expresses
*addressability*: it is one-time, additive, idempotent, inert to every other Client, and
carries no information about which Loadout is active. Activation still happens entirely
through session flags. A crashed plugged-in leaves annotated skills behind, and annotated
skills behave exactly like unannotated ones when plugged-in is not running.

## Considered Options

- **Annotate at Activation, remove on exit** — no persistent footprint, but concurrent
  sessions race on the same files and a crash leaves debris. Rejected: reintroduces the
  failure mode ADR-0001 exists to prevent.
- **Compose an ephemeral plugin per Activation and load it with `--plugin-dir`** — rejected:
  Claude Code skips symlinks resolving outside a plugin's own directory, so the skills would
  have to be copied on every launch, and the originals would still load from
  `~/.claude/skills/` unless installation were also redirected.
- **Leave loose skills ungoverned** — rejected once Loadouts were defined as context
  optimization rather than governance; unfilterable skills are then a hole in the product's
  only job.

## Consequences

Annotation must be reversible (`plugged-in adopt --undo`) and drift-detectable, because
`npx skills update` may overwrite an annotated skill folder. The shim becomes unnecessary if
Claude Code ever reads the Agent Plugins root `plugin.json`, and should be removed then.
