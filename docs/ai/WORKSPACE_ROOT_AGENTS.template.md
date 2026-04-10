# AGENTS.md

This parent folder is a shared workspace container, not a git repo.

## Workspace Layout

- App repo: `__APP_REPO__`
- Backlog repo: `__BACKLOG_REPO__`

## Default Execution Rules

- Run git-aware product work from `righelt-app` unless the task explicitly targets the backlog repo.
- Run backlog content writes in `righelt-backlog`, or use the wrappers in `righelt-app/scripts/` which resolve that sibling repo automatically.
- Do not assume the parent workspace root has branch context; it exists so tools can access both sibling repos without crossing outside the opened workspace.

## Key Commands

- Setup check: `node scripts/check-ticket-workflow-setup.mjs` from `righelt-app`
- Backlog CLI wrapper: `./scripts/backlog.sh ...` from `righelt-app`
- Backlog git wrapper: `./scripts/backlog-git.sh ...` from `righelt-app`
