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

# Resolve the main repo root via git — works from the main checkout or any worktree.
# git-common-dir points to the shared .git directory; strip the trailing /.git to
# get the main repo root regardless of how deeply nested the worktree is.
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || true)

if [[ -n "$GIT_COMMON" ]]; then
  if [[ "$GIT_COMMON" == ".git" ]]; then
    MAIN_REPO="$(git rev-parse --show-toplevel)"
  else
    # Worktree: git-common-dir is an absolute path like /path/to/repo/.git
    MAIN_REPO="${GIT_COMMON%/.git}"
  fi
else
  # Not inside a git repo — resolve relative to the script's real location (parent symlink case)
  REAL_SCRIPT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}")")" && pwd)"
  MAIN_REPO="$(cd "$REAL_SCRIPT/.." && pwd)"
fi

BACKLOG_CWD="$(dirname "$MAIN_REPO")/righelt-backlog/backlog"

if [[ ! -d "$BACKLOG_CWD" ]]; then
  echo "ERROR: Shared backlog not found at $BACKLOG_CWD" >&2
  echo "Clone righelt-backlog as a sibling of this repo first." >&2
  exit 1
fi

BACKLOG_BIN="${BACKLOG_BIN:-$(command -v backlog 2>/dev/null || echo /opt/homebrew/bin/backlog)}"
cd "$BACKLOG_CWD"
exec "$BACKLOG_BIN" "$@"
