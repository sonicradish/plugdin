#!/usr/bin/env bash
# S5 — Does a large Inventory blow the `-c` argument list on Codex?
# Purely mechanical: `codex doctor` parses config/CLI overrides and exits without any
# network or model call, so this is free and side-effect-free.
set -euo pipefail

N="${1:-500}"
echo "Building $N synthetic -c overrides..."

args=()
for i in $(seq 1 "$N"); do
  args+=("-c" "plugins.\"synthetic-plugin-$i@fixture\".enabled=false")
done

echo "Total argv entries: ${#args[@]}"
start=$(date +%s%N 2>/dev/null || echo 0)
if codex doctor --summary "${args[@]}" >/tmp/s5-codex-doctor.out 2>&1; then
  status="ok"
else
  status="FAILED (exit $?)"
fi
end=$(date +%s%N 2>/dev/null || echo 0)

echo "codex doctor with $N -c overrides: $status"
tail -5 /tmp/s5-codex-doctor.out
echo
echo "(compare against 'getconf ARG_MAX': $(getconf ARG_MAX 2>/dev/null || echo unknown))"
