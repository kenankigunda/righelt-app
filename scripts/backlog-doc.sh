#!/usr/bin/env bash
# backlog-doc.sh
#
# Resolves canonical ticket-document paths inside the sibling righelt-backlog
# repo. This keeps common doc operations on a stable direct command prefix.
#
# Usage:
#   ./scripts/backlog-doc.sh path t-123 spec
#   ./scripts/backlog-doc.sh ensure t-123

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: ./scripts/backlog-doc.sh <path|ensure> <ticket-id> [spec|eng-plan|test-plan|coordination-log]" >&2
  exit 1
fi

ACTION="$1"
TICKET_ID="$2"
DOC_KIND="${3:-}"

case "$TICKET_ID" in
  t-[0-9][0-9][0-9]*)
    ;;
  *)
    echo "ERROR: Ticket id must look like t-123 or t-123.04" >&2
    exit 1
    ;;
esac

GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || true)

if [[ -n "$GIT_COMMON" ]]; then
  if [[ "$GIT_COMMON" == ".git" ]]; then
    MAIN_REPO="$(git rev-parse --show-toplevel)"
  else
    MAIN_REPO="${GIT_COMMON%/.git}"
  fi
else
  # Not inside a git repo — resolve relative to the script's real location (parent symlink case)
  REAL_SCRIPT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}")")" && pwd)"
  MAIN_REPO="$(cd "$REAL_SCRIPT/.." && pwd)"
fi

TICKET_DIR="$(dirname "$MAIN_REPO")/righelt-backlog/backlog/docs/tickets/$TICKET_ID"

resolve_doc_name() {
  case "$1" in
    spec) echo "spec.md" ;;
    eng-plan) echo "eng-plan.md" ;;
    test-plan) echo "test-plan.md" ;;
    coordination-log) echo "coordination-log.md" ;;
    *)
      echo "ERROR: Unsupported doc kind '$1'. Use spec, eng-plan, test-plan, or coordination-log." >&2
      exit 1
      ;;
  esac
}

case "$ACTION" in
  ensure)
    mkdir -p "$TICKET_DIR"
    printf '%s\n' "$TICKET_DIR"
    ;;
  path)
    if [[ -z "$DOC_KIND" ]]; then
      echo "ERROR: path requires a doc kind." >&2
      exit 1
    fi
    DOC_NAME=$(resolve_doc_name "$DOC_KIND")
    printf '%s\n' "$TICKET_DIR/$DOC_NAME"
    ;;
  *)
    echo "ERROR: Unsupported action '$ACTION'. Use path or ensure." >&2
    exit 1
    ;;
esac
