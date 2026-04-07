#!/usr/bin/env bash
# backlog-mcp-start.sh
#
# Starts the Backlog.md MCP server pointed at the shared righelt-backlog repo.
# Works correctly from the main repo root or any worktree — no hardcoded paths.
#
# Usage: registered via `claude mcp add backlog -- /path/to/scripts/backlog-mcp-start.sh`

set -euo pipefail

# Derive paths from the script's own location — reliable regardless of CWD,
# since the MCP host may start this from $HOME or any arbitrary directory.
#
# Layout assumption:
#   <parent>/
#     righelt/scripts/backlog-mcp-start.sh   (this file)
#     righelt-backlog/backlog/config.yml      (backlog root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN_REPO="$(dirname "$SCRIPT_DIR")"          # righelt/
BACKLOG_REPO="$(dirname "$MAIN_REPO")/righelt-backlog"
# The MCP's --cwd must point at the backlog/ subdirectory (where config.yml lives).
# The CLI auto-discovers the subdir from the repo root, but the MCP server does not.
BACKLOG_CWD="$BACKLOG_REPO/backlog"

if [[ ! -d "$BACKLOG_CWD" ]]; then
  echo "ERROR: Shared backlog not found at $BACKLOG_CWD" >&2
  echo "Run the setup from docs/tickets/t-083/eng-plan.md to initialise it." >&2
  exit 1
fi

BACKLOG_BIN="${BACKLOG_BIN:-$(command -v backlog 2>/dev/null || echo /opt/homebrew/bin/backlog)}"
exec "$BACKLOG_BIN" mcp start --cwd "$BACKLOG_CWD" "$@"
