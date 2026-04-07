#!/usr/bin/env bash
# backlog-mcp-start.sh
#
# Starts the Backlog.md MCP server pointed at the shared righelt-backlog repo.
# Works correctly from the main repo root or any worktree — no hardcoded paths.
#
# Usage: registered via `claude mcp add backlog -- /path/to/scripts/backlog-mcp-start.sh`

set -euo pipefail

# git-common-dir points to the main repo's .git regardless of whether we're
# in the main repo or a worktree.
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)

if [[ "$GIT_COMMON" == ".git" ]]; then
  # Running from the main repo root
  MAIN_REPO="$(git rev-parse --show-toplevel)"
else
  # Running from a worktree — strip the trailing /.git to get the main repo root
  MAIN_REPO="${GIT_COMMON%/.git}"
fi

BACKLOG_REPO="$(dirname "$MAIN_REPO")/righelt-backlog"
# The MCP's --cwd must point at the backlog/ subdirectory (where config.yml lives),
# not the repo root. The CLI auto-discovers the subdir, but the MCP does not.
BACKLOG_CWD="$BACKLOG_REPO/backlog"

if [[ ! -d "$BACKLOG_CWD" ]]; then
  echo "ERROR: Shared backlog not found at $BACKLOG_CWD" >&2
  echo "Run the setup from docs/tickets/t-083/eng-plan.md to initialise it." >&2
  exit 1
fi

BACKLOG_BIN="${BACKLOG_BIN:-$(command -v backlog 2>/dev/null || echo /opt/homebrew/bin/backlog)}"
exec "$BACKLOG_BIN" mcp start --cwd "$BACKLOG_CWD" "$@"
