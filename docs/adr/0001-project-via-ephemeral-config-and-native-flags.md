# Project Loadouts through ephemeral config and native client flags

Activation is session-scoped, so Projection generates throwaway configuration for a single
launch and passes it to the Client through flags it already supports — never by mutating
the user's real configuration directories. A crashed or killed pluggedin therefore cannot
leave a machine in a wrong state, and two terminals can run different Loadouts at once.

## Considered Options

- **Symlink farm** — relink `~/.claude/` and `~/.codex/` so Clients pick up whatever is
  currently linked. Rejected: it is machine-scoped, not session-scoped, so concurrent
  sessions cannot differ; it mutates state the Client's own tooling owns; and an abnormal
  exit leaves the machine misconfigured.
- **Config-home redirect** — synthesize a whole `CLAUDE_CONFIG_DIR` / `CODEX_HOME` per
  Loadout. Rejected: credentials, history, and project state live there too, so the
  synthesized home must shadow everything, and that shadow must be maintained against two
  vendors' refactors indefinitely.

## Consequences

Projection is limited to what each Client exposes as a session-level override. A Component a
Client only reads from a fixed on-disk location, with no override, is unreachable under this
decision.

Loose skills in `~/.claude/skills/` initially looked unreachable, since no setting filters
them. They are reachable after Annotation: a skill folder containing `.claude-plugin/plugin.json`
loads as a plugin named `<skill>@skills-dir`, which `enabledPlugins` then filters at the
discovery level. Verified empirically — the annotated skill leaves the model's context
entirely and keeps its original invocation name.

Rejecting the config-home redirect was also confirmed empirically: pointing `CLAUDE_CONFIG_DIR`
at a synthesized directory breaks authentication outright.
