#!/usr/bin/env bash
# S1 — Is `enabledPlugins` an allowlist ("only these load") or a per-key override?
# Mechanical: `claude plugin list --json` is local introspection, no model turn, no
# mutation of real config (settings passed via --settings are session-scoped per ADR-0001).
set -euo pipefail

PLUGIN_A="code-review@claude-plugins-official"
PLUGIN_B="commit-commands@claude-plugins-official"

echo "== baseline: no --settings override =="
claude plugin list --json 2>&1 || true

echo
echo "== overlay: enable only $PLUGIN_A via --settings =="
claude --settings "{\"enabledPlugins\":{\"$PLUGIN_A\":true}}" plugin list --json 2>&1 || true

echo
echo "== overlay: enable $PLUGIN_A and $PLUGIN_B, then disable $PLUGIN_B =="
claude --settings "{\"enabledPlugins\":{\"$PLUGIN_A\":true,\"$PLUGIN_B\":false}}" plugin list --json 2>&1 || true

echo
echo "Interpretation: if the third run shows ONLY $PLUGIN_A as enabled (not every other"
echo "installed/available plugin implicitly off), enabledPlugins keys not mentioned are"
echo "left at their prior state -> per-key override, not a replacing allowlist."
echo "If plugins outside the map are also forced off, it's an allowlist."
