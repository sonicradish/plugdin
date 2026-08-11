# plugdin

Decides which agent extensions are active in a coding-agent session, and makes that
decision portable across agent clients. It selects; it does not install.

## Language

**Component**:
A single governable unit of agent extension: a plugin, a skill, or an MCP server.
_Avoid_: extension, capability, tool

**Client**:
A coding agent runtime that loads Components, such as Claude Code, Codex, Grok Build,
OpenCode, or Pi.
_Avoid_: agent, host, harness, tool

**Inventory**:
The set of Components installed on a machine, discovered across all Clients.
_Avoid_: registry, catalog, index

**Profile**:
A named, reusable decision about which Components are active. Expressed as a set of
allows and denies over a Baseline.
_Avoid_: loadout, preset, config, workspace

**Baseline**:
The starting point a Profile is expressed against: everything on, everything off, or
another Profile.
_Avoid_: default, base, parent

**Activation**:
Applying a Profile to a single Client session. Bound to the session, not to the machine.
_Avoid_: enabling, switching, loading

**Annotation**:
A manifest file added beside an installed skill so a Client that cannot otherwise address
that skill can include it in a Profile. A compatibility shim, not a packaging change.
_Avoid_: wrapping, conversion, adoption

**Projection**:
Translating a Profile into the native configuration a specific Client understands.
_Avoid_: rendering, materializing, syncing, compiling
