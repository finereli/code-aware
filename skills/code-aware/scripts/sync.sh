#!/usr/bin/env bash
# Incrementally update code awareness models with new commits
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec npx --prefix "$TOOL_ROOT" tsx "$TOOL_ROOT/src/index.ts" sync --repo "${1:-.}"
