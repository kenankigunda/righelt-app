#!/usr/bin/env bash
# backlog-sync.sh
#
# Stable thin wrapper for the documented backlog git bookends. Prefer these
# commands over ad hoc shell snippets so agent approval prefixes stay narrow.
#
# Usage:
#   ./scripts/backlog-sync.sh pull
#   ./scripts/backlog-sync.sh push
#   ./scripts/backlog-sync.sh commit -am "chore(backlog): update t-123 reason"

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: ./scripts/backlog-sync.sh <pull|push|commit> [git args...]" >&2
  exit 1
fi

COMMAND="$1"
shift

case "$COMMAND" in
  pull)
    exec "$(dirname "$0")/backlog-git.sh" pull --rebase origin main "$@"
    ;;
  push)
    exec "$(dirname "$0")/backlog-git.sh" push origin main "$@"
    ;;
  commit)
    exec "$(dirname "$0")/backlog-git.sh" commit "$@"
    ;;
  *)
    echo "ERROR: Unsupported backlog sync command '$COMMAND'. Use pull, push, or commit." >&2
    exit 1
    ;;
esac
