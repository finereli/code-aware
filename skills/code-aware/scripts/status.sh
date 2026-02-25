#!/usr/bin/env bash
# Check if code awareness models are current
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec npx --prefix "$TOOL_ROOT" tsx "$TOOL_ROOT/src/index.ts" status --repo "${1:-.}"
