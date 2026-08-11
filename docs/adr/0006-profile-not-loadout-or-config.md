# The named unit is a Profile, not a Loadout or a config

The core noun shipped as **Loadout** through v0.3.1 and was renamed to **Profile** after that
term proved to be jargon: it reads as gaming vocabulary and gave first-time readers nothing to
pattern-match against. **Profile** carries its meaning for free: AWS profiles, Chrome
profiles, shell profiles are all the same idea of a named, switchable set of settings.

**config** was the obvious alternative and is rejected deliberately: plugdin already has
`.plugdin/config.toml` for its own settings, so a Profile called a config would make "the
config" ambiguous in every sentence and force that file to be renamed to clear the way.
**preset** implies something the tool ships rather than something you author.

## Consequences

The rename is a hard break with no alias: `--loadout` is gone rather than deprecated, and
`~/.plugdin/loadouts/` is not read as a fallback. At v0.3.1 with no meaningful install base
this costs one directory rename for anyone affected, which is worth more than carrying two
names for the same concept indefinitely.
