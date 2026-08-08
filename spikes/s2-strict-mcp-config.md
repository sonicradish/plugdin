# S2 — does `--strict-mcp-config` also suppress plugin-provided MCP servers?

Not automatable mechanically: `claude mcp list` is a separate process from a running
session and only reports servers from `.mcp.json` / `claude mcp add`, not what a live
session actually loaded from a plugin. The real answer requires asking a running session
what MCP tools it can see, which spends a small amount of real API usage. Not run
automatically by this repo; run by hand:

```bash
# Baseline: a plugin that declares an MCP server, no --strict-mcp-config.
claude -p "List the names of every MCP tool available to you, one per line, nothing else." \
  --settings '{"enabledPlugins":{"<plugin-providing-mcp>@<marketplace>":true}}'

# Same session, but with --strict-mcp-config and an empty --mcp-config.
claude -p "List the names of every MCP tool available to you, one per line, nothing else." \
  --settings '{"enabledPlugins":{"<plugin-providing-mcp>@<marketplace>":true}}' \
  --mcp-config '{"mcpServers":{}}' --strict-mcp-config
```

If the plugin's MCP tools disappear in the second run, `--strict-mcp-config` suppresses
plugin-provided servers too, and Claude Code Projection (Phase 3) must re-emit every
surviving plugin's MCP servers into `--mcp-config` explicitly rather than relying on
`enabledPlugins` alone to carry them.

Needs a real installed plugin that declares an MCP server as `<plugin-providing-mcp>` —
none of the currently-installed Inventory in this environment declares one (checked via
`claude plugin list --json`, which returned `[]`). Substitute one before running.
