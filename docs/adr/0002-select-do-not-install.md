# plugdin selects Components; it does not install them

Installation is already solved cross-client: `npx plugins` installs Agent Plugins into
Claude Code, Codex, Cursor, Grok Build, Kimi Code, Copilot CLI and VS Code, and
`npx skills` does the same for skills. plugdin reads the resulting Inventory and decides
what is active. Rebuilding installation would duplicate that work worse and would put us in
competition with the ecosystem we want to complement.

## Consequences

The Inventory is discovered, not owned, so plugdin must tolerate Components appearing and
disappearing between Activations without its involvement. A Loadout must therefore reference
Components by identity rather than by index into a list we control.
