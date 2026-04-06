#!/usr/bin/env bash
# backlog-git.sh
#
# Runs git commands against the shared righelt-backlog repo.
# Works from the main repo root or any worktree — no hardcoded paths.
#
# Usage:
#   ./scripts/backlog-git.sh pull --rebase origin main   # pull before write
#   ./scripts/backlog-git.sh push origin main            # push after write
#   ./scripts/backlog-git.sh commit -am "chore: ..."    # manual commit (direct edits only)
#
# Write path protocol (applies to all three write paths):
#   MCP:         pull → MCP tool call → push   (auto_commit handles local commit)
#   CLI:         pull → backlog task edit ...  → push   (auto_commit handles local commit)
#   Direct edit: pull → edit file → commit → push

set -euo pipefail

GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)

if [[ "$GIT_COMMON" == ".git" ]]; then
  MAIN_REPO="$(git rev-parse --show-toplevel)"
else
  MAIN_REPO="${GIT_COMMON%/.git}"
fi

BACKLOG_REPO="$(dirname "$MAIN_REPO")/righelt-backlog"

if [[ ! -d "$BACKLOG_REPO" ]]; then
  echo "ERROR: Shared backlog repo not found at $BACKLOG_REPO" >&2
  exit 1
fi

exec git -C "$BACKLOG_REPO" "$@"
