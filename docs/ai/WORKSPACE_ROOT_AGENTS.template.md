# AGENTS.md

This parent folder is a shared workspace container, not a git repo.

## Start Here

- If you are working on product code, open `/Users/kenankigunda/Documents/righelt/righelt-app/AGENTS.md` before making changes.
- Treat `righelt-app` as the default git-aware execution root unless the task explicitly targets `righelt-backlog`.
- Treat `righelt-backlog` as the shared backlog repo and not as the default execution root for product code.

## Workspace Layout

- App repo: `__APP_REPO__`
- Backlog repo: `__BACKLOG_REPO__`

## Default Execution Rules

- Run git-aware product work from `righelt-app` unless the task explicitly targets the backlog repo.
- Run backlog content writes in `righelt-backlog`, or use the wrappers in `righelt-app/scripts/` which resolve that sibling repo automatically.
- Prefer direct command invocation with repo wrappers instead of shell-wrapper commands such as `/bin/zsh -lc ...` whenever possible.
- Treat shell wrappers as a last resort for commands that genuinely require shell features or login-shell environment setup.
- Do not assume the parent workspace root has branch context; it exists so tools can access both sibling repos without crossing outside the opened workspace.

## Repo Instructions

- The full repo operating manual lives in `__APP_REPO__/AGENTS.md`.
- Read that file before interpreting team shorthands or performing git, test, backlog, ticket, branch, or worktree workflow actions.
- Team shorthands such as `Cp`, `Opr`, `Snb`, `Snbom`, `Rgr`, `Tk`, and `Es` are defined there.
- Repo testing policy, branch conventions, backlog protocol, and ticket workflow rules are defined there.

## Shorthand Preview

- `Cp` = commit + push + wait before continuing
- `Opr` = open a PR and give the link
- `Snbom` = switch to a new `codex/` branch off `origin/main`

## Backlog Safety

- The parent workspace itself is not a git repo.
- Prefer backlog writes through `righelt-app/scripts/backlog.sh`.
- Pull before backlog writes and push after using `righelt-app/scripts/backlog-sync.sh`.

## Key Commands

- Setup check: `node scripts/check-ticket-workflow-setup.mjs` from `righelt-app`
- App repo git wrapper: `./scripts/git-app.sh ...` from `righelt-app`
- Backlog CLI wrapper: `./scripts/backlog.sh ...` from `righelt-app`
- Backlog git wrapper: `./scripts/backlog-git.sh ...` from `righelt-app`
- Backlog sync wrapper: `./scripts/backlog-sync.sh ...` from `righelt-app`
- Backlog doc path helper: `./scripts/backlog-doc.sh ...` from `righelt-app`

## Parent Workspace Files

The tracked sources of truth for the parent workspace bootstrap files live in `docs/ai/`:
- `WORKSPACE_ROOT_AGENTS.template.md` → parent `AGENTS.md`
- `WORKSPACE_ROOT_CLAUDE.template.md` → parent `CLAUDE.md`
- `WORKSPACE_ROOT_SETTINGS_LOCAL.template.json` → parent `.claude/settings.local.json`

Refresh all parent files with `pnpm setup:workspace`.

Whenever you change parent-workspace guidance, permissions, or settings, update the relevant tracked template(s) in the repo and regenerate the parent files in the same change so the live workspace files stay aligned with the tracked templates.

## Validation and shepherding

For end-to-end evidence, integrated PR validation, and autonomous repairs, read the released `__VALIDATION_TOOLS__/skills/validate-and-shepherd/SKILL.md`. Use its CLI with `--candidate /absolute/path` for the intended app checkout. The installed tools stay pinned to a merged revision; a candidate branch is not the tooling source. If the released checkout is missing, report the missing installation and prepare the explicit installer command; do not silently use an unmerged candidate skill. Review readiness, merge authorization, and deployment activation are separate. A paused schedule stays paused until explicitly resumed.
