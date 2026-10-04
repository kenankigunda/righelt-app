#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/setup-workspace.sh [--clone-backlog] [--backlog-url URL] [--help]

Validates the expected parent workspace layout for this repo, writes the parent
AGENTS.md and CLAUDE.md from tracked templates, and optionally clones
righelt-backlog if it is missing.

Options:
  --clone-backlog      Clone the sibling backlog repo if it does not exist
  --backlog-url URL    Override the backlog clone URL
  --help               Show this help text
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_NAME="$(basename "$APP_REPO")"
WORKSPACE_ROOT="$(dirname "$APP_REPO")"
WORKSPACE_NAME="$(basename "$WORKSPACE_ROOT")"
BACKLOG_REPO="$WORKSPACE_ROOT/righelt-backlog"
VALIDATION_TOOLS="$WORKSPACE_ROOT/righelt-validation-tools"
ROOT_AGENTS_PATH="$WORKSPACE_ROOT/AGENTS.md"
ROOT_CLAUDE_PATH="$WORKSPACE_ROOT/CLAUDE.md"
AGENTS_TEMPLATE_PATH="$APP_REPO/docs/ai/WORKSPACE_ROOT_AGENTS.template.md"
CLAUDE_TEMPLATE_PATH="$APP_REPO/docs/ai/WORKSPACE_ROOT_CLAUDE.template.md"
SETTINGS_LOCAL_TEMPLATE_PATH="$APP_REPO/docs/ai/WORKSPACE_ROOT_SETTINGS_LOCAL.template.json"
ROOT_SETTINGS_LOCAL_PATH="$WORKSPACE_ROOT/.claude/settings.local.json"
CLONE_BACKLOG=0
BACKLOG_URL="${BACKLOG_URL:-https://github.com/kenankigunda/righelt-backlog.git}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clone-backlog)
      CLONE_BACKLOG=1
      shift
      ;;
    --backlog-url)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --backlog-url requires a value." >&2
        exit 1
      fi
      BACKLOG_URL="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$APP_NAME" != "righelt-app" ]]; then
  echo "ERROR: Expected this repo directory to be named righelt-app, got: $APP_NAME" >&2
  echo "Move or clone this repo into <parent>/righelt-app, then rerun this script." >&2
  exit 1
fi

if [[ ! -f "$AGENTS_TEMPLATE_PATH" ]]; then
  echo "ERROR: Missing tracked workspace AGENTS template at $AGENTS_TEMPLATE_PATH" >&2
  exit 1
fi

if [[ ! -f "$CLAUDE_TEMPLATE_PATH" ]]; then
  echo "ERROR: Missing tracked workspace CLAUDE template at $CLAUDE_TEMPLATE_PATH" >&2
  exit 1
fi

if [[ ! -f "$SETTINGS_LOCAL_TEMPLATE_PATH" ]]; then
  echo "ERROR: Missing tracked workspace settings.local.json template at $SETTINGS_LOCAL_TEMPLATE_PATH" >&2
  exit 1
fi

if [[ "$WORKSPACE_NAME" != "righelt" ]]; then
  echo "WARNING: Expected parent workspace folder to be named righelt, got: $WORKSPACE_NAME" >&2
  echo "The generated parent workspace instructions will still target: $WORKSPACE_ROOT" >&2
fi

mkdir -p "$WORKSPACE_ROOT"

APP_REPO_ESCAPED=${APP_REPO//\//\\/}
BACKLOG_REPO_ESCAPED=${BACKLOG_REPO//\//\\/}

sed \
  -e "s|__VALIDATION_TOOLS__|$VALIDATION_TOOLS|g" \
  -e "s/__APP_REPO__/$APP_REPO_ESCAPED/g" \
  -e "s/__BACKLOG_REPO__/$BACKLOG_REPO_ESCAPED/g" \
  "$AGENTS_TEMPLATE_PATH" > "$ROOT_AGENTS_PATH"

echo "Wrote parent AGENTS.md: $ROOT_AGENTS_PATH"

sed \
  -e "s|__VALIDATION_TOOLS__|$VALIDATION_TOOLS|g" \
  -e "s/__APP_REPO__/$APP_REPO_ESCAPED/g" \
  -e "s/__BACKLOG_REPO__/$BACKLOG_REPO_ESCAPED/g" \
  "$CLAUDE_TEMPLATE_PATH" > "$ROOT_CLAUDE_PATH"

echo "Wrote parent CLAUDE.md: $ROOT_CLAUDE_PATH"

mkdir -p "$WORKSPACE_ROOT/.claude"
cp "$SETTINGS_LOCAL_TEMPLATE_PATH" "$ROOT_SETTINGS_LOCAL_PATH"

echo "Wrote parent .claude/settings.local.json: $ROOT_SETTINGS_LOCAL_PATH"

# Symlink parent scripts/ → app scripts/ so ./scripts/* works from the parent workspace cwd
PARENT_SCRIPTS_LINK="$WORKSPACE_ROOT/scripts"
if [[ -L "$PARENT_SCRIPTS_LINK" ]]; then
  rm "$PARENT_SCRIPTS_LINK"
fi
if [[ -e "$PARENT_SCRIPTS_LINK" ]]; then
  echo "WARNING: $PARENT_SCRIPTS_LINK exists and is not a symlink — skipping symlink creation." >&2
else
  ln -s "$APP_REPO/scripts" "$PARENT_SCRIPTS_LINK"
  echo "Linked parent scripts/: $PARENT_SCRIPTS_LINK → $APP_REPO/scripts"
fi

if [[ -d "$BACKLOG_REPO/.git" ]]; then
  echo "Found sibling backlog repo: $BACKLOG_REPO"
elif [[ -e "$BACKLOG_REPO" ]]; then
  echo "ERROR: $BACKLOG_REPO exists but is not a git repo." >&2
  exit 1
elif [[ "$CLONE_BACKLOG" -eq 1 ]]; then
  echo "Cloning sibling backlog repo into: $BACKLOG_REPO"
  git clone "$BACKLOG_URL" "$BACKLOG_REPO"
else
  echo "Sibling backlog repo is missing: $BACKLOG_REPO"
  echo "Rerun with --clone-backlog to clone it automatically." >&2
fi

echo "Workspace root: $WORKSPACE_ROOT"
echo "App repo: $APP_REPO"
echo "Backlog repo: $BACKLOG_REPO"

echo "Released validation tools: $VALIDATION_TOOLS (install/update separately after merge)"
