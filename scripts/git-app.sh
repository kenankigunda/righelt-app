#!/usr/bin/env bash
# git-app.sh
#
# Runs git commands against the current righelt-app checkout or worktree.
# Prefer this stable direct wrapper over shell-string invocations when a command
# should target the local app checkout specifically.

set -euo pipefail

# Resolve via git if inside a repo, otherwise resolve relative to the
# script's real location (handles parent workspace symlink).
APP_REPO="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$APP_REPO" || ! -d "$APP_REPO/.git" && ! -f "$APP_REPO/.git" ]]; then
  REAL_SCRIPT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}")")" && pwd)"
  APP_REPO="$(cd "$REAL_SCRIPT/.." && pwd)"
fi

if [[ ! -d "$APP_REPO/.git" && ! -f "$APP_REPO/.git" ]]; then
  echo "ERROR: App repo not found at $APP_REPO" >&2
  exit 1
fi

exec git -C "$APP_REPO" "$@"
