# Project through an environment overlay, and an ephemeral config home where no flag exists

ADR-0001 settled how Projection reaches a Client: throwaway configuration handed over
through flags the Client already supports. Adding Grok Build, OpenCode, and Pi found two
Clients that expose no such flag, so `Projection` gains two more delivery mechanisms
alongside `args`:

- **`env`**: an environment overlay applied over the inherited environment at spawn.
  OpenCode's entire config surface is reachable this way: `OPENCODE_CONFIG_CONTENT` takes
  inline JSON and is merged last, after the global, project, and managed layers.
- **`mirrors`**: an ephemeral directory of symlinks back into a Client's real config home,
  with the one file Projection needs to control replaced by a generated one, pointed at
  through that Client's config-home environment variable. Grok Build needs this: it has no
  `-c key=value` override, no config-path variable, and its layers are fixed on disk.

Pi needed neither. Its CLI already expresses a Profile directly. `--no-skills` /
`--no-extensions` turn discovery off while explicit `--skill` / `--extension` paths still
load, which is an allowlist in the native argv, exactly the shape ADR-0001 prefers.

## Why this does not contradict ADR-0001

ADR-0001 rejected a "symlink farm" and a "config-home redirect" as *alternatives* to
ephemeral config. What it rejected, in its own words, was relinking `~/.claude/` and
`~/.codex/` in place (machine-scoped, so concurrent sessions cannot differ, and an abnormal
exit leaves the machine misconfigured), and synthesizing a whole config home from nothing,
which was verified to break authentication outright.

The mirror is neither. It is session-scoped: a fresh temp directory per launch, with the
real config home never modified or relinked. Two terminals can run different Profiles at
once, and an abnormal exit leaves an orphaned temp directory rather than a broken machine,
the same failure mode the existing generated files already have. And it does not synthesize
a home: everything except the one replaced file is a symlink to the user's real file, which
is precisely why the objection that killed the redirect does not apply. Verified live
2026-08-09: under an ephemeral `GROK_HOME`, `grok models` still reports a logged-in account,
and `grok inspect --json` shows the generated `config.toml` as the sole user layer.

Symlinks rather than copies, deliberately: a Client writes to its config home during a
session (sessions, caches, refreshed credentials), and through a symlink those writes land
in the user's real files instead of being thrown away with the temp directory.

## Consequences

The residual risk is narrow and worth stating plainly: a file the Client creates *fresh* at
the top level of its config home during a session, one that did not exist when the mirror
was built, lands in the temp directory and is discarded. Anything inside an existing
subdirectory (sessions, worktrees, caches) follows its symlink to the real location. No such
top-level file has been observed in practice; if one shows up, the fix is to mirror
subdirectory-by-subdirectory rather than to abandon the approach.

`explain` prints both the environment overlay and the mirror it would build, so the
indirection stays inspectable before it is trusted, the same requirement generated files
have always had. `materializeProjection` builds mirrors before writing files, since the
generated file is normally the entry the mirror deliberately left out.

`Projection` also gains `notes`: client-level remarks about *how* a decision is enforced,
always printed, never blocking. This is not a third flavour of `warnings` (ADR-0004). A
warning says a decision could not be projected and the Component was left as the Client's
own config has it. A note says the decision *was* projected, by a mechanism whose behavior
differs from "the Component is simply not there": OpenCode has no per-skill discovery
filter, so a skill turned off is denied through its `skill` permission: it cannot run, but
its name stays in the model's catalog. Reporting that as a warning would misstate it as
unprojected; reporting nothing would hide a real difference from what "off" means elsewhere.

## Considered Options

- **Warn on everything Grok cannot express through flags**: rejected: it would make Grok
  support read-only in practice, since Grok exposes no session-level toggle for skills,
  plugins, or MCP servers at all. Every Profile targeting Grok would be advisory.
- **Write an ephemeral `<cwd>/.grok/config.toml`**: Grok's highest-priority layer, no
  symlinks needed. Rejected: it mutates the user's working tree mid-session, so a crash
  leaves a stray config file inside a repo, possibly committed. ADR-0001's "a crashed or
  killed plugdin cannot leave a machine in a wrong state" applies with more force inside
  a git working tree, not less.
- **Set `HOME` to a synthesized directory**: the one lever that would work uniformly for
  any Client. Rejected for the same reason ADR-0001 rejected the config-home redirect, only
  worse: it moves every tool's configuration, not one Client's.
- **Support Cursor CLI in this batch**: dropped rather than faked. Cursor reads `mcp.json`
  only from `homedir()/.cursor/` and `<projectRoot>/.cursor/`, both hard-coded in its
  bundle; `CURSOR_CONFIG_DIR` and `XDG_CONFIG_HOME` were both tested live and neither
  redirects it, and Cursor has no skill or plugin toggle. Adding it would mean a Client
  whose every Profile decision is a warning. It can be revisited if Cursor grows a
  session-level override.
