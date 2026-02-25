#!/usr/bin/env bash
# Scan a repo's git history and generate code awareness models
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
TOOL_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
REPO="${1:-.}"
shift 2>/dev/null || true
exec npx --prefix "$TOOL_ROOT" tsx "$TOOL_ROOT/src/index.ts" scan --repo "$REPO" "$@"
