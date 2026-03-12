#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "${SCRIPT_DIR}")}"
HOOKFLOW_ENTRY="${PLUGIN_ROOT}/dist/index.js"

if [ ! -f "${HOOKFLOW_ENTRY}" ]; then
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "hookflow: node not found" >&2
  exit 0
fi

exec node "${HOOKFLOW_ENTRY}" "$@"
