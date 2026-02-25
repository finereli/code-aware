#!/usr/bin/env bash
# Check if code awareness models are current
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec npx --prefix "$TOOL_ROOT" tsx "$TOOL_ROOT/src/index.ts" status --repo "${1:-.}"
