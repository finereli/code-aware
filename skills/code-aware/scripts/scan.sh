#!/usr/bin/env bash
# Scan a repo's git history and generate code awareness models
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec npx --prefix "$TOOL_ROOT" tsx "$TOOL_ROOT/src/index.ts" scan --repo "${1:-.}"
