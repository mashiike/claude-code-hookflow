#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "${SCRIPT_DIR}")}"
HOOKFLOW_BIN="${PLUGIN_ROOT}/bin/claude-code-hookflow"

if [ ! -x "${HOOKFLOW_BIN}" ]; then
  exit 0
fi

exec "${HOOKFLOW_BIN}" "$@"
