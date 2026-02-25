#!/usr/bin/env bash
# Incrementally update code awareness models with new commits
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec npx --prefix "$TOOL_ROOT" tsx "$TOOL_ROOT/src/index.ts" sync --repo "${1:-.}"
