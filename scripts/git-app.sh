#!/usr/bin/env bash
# git-app.sh
#
# Runs git commands against the current righelt-app checkout or worktree.
# Prefer this stable direct wrapper over shell-string invocations when a command
# should target the local app checkout specifically.

set -euo pipefail

APP_REPO="$(git rev-parse --show-toplevel 2>/dev/null)"

if [[ -z "$APP_REPO" ]]; then
  echo "ERROR: Not inside a git repository. Cannot resolve app repo path." >&2
  exit 1
fi

if [[ ! -d "$APP_REPO/.git" && ! -f "$APP_REPO/.git" ]]; then
  echo "ERROR: App repo not found at $APP_REPO" >&2
  exit 1
fi

exec git -C "$APP_REPO" "$@"
