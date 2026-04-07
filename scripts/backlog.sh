#!/usr/bin/env bash
# backlog.sh
#
# CLI wrapper for the Backlog.md tool pointed at the shared righelt-backlog repo.
# Works correctly from the main repo root or any worktree — no hardcoded paths.
#
# Usage:
#   ./scripts/backlog.sh task list
#   ./scripts/backlog.sh task view t-083
#   ./scripts/backlog.sh task edit t-083 --status "In Progress"

set -euo pipefail

# Derive paths from the script's own location — reliable regardless of CWD,
# since agents may invoke this from any directory.
#
# Layout assumption:
#   <parent>/
#     righelt/scripts/backlog.sh   (this file)
#     righelt-backlog/backlog/     (backlog root, where config.yml lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_REPO="$(dirname "$SCRIPT_DIR")"          # righelt/
BACKLOG_CWD="$(dirname "$MAIN_REPO")/righelt-backlog/backlog"

if [[ ! -d "$BACKLOG_CWD" ]]; then
  echo "ERROR: Shared backlog not found at $BACKLOG_CWD" >&2
  echo "Clone righelt-backlog as a sibling of this repo first." >&2
  exit 1
fi

BACKLOG_BIN="${BACKLOG_BIN:-$(command -v backlog 2>/dev/null || echo /opt/homebrew/bin/backlog)}"
cd "$BACKLOG_CWD"
exec "$BACKLOG_BIN" "$@"
