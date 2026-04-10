# Workspace Setup

This repo is intended to live inside a parent workspace folder that contains two sibling repos:

- `righelt/righelt-app`
- `righelt/righelt-backlog`

The parent workspace exists so local AI tools can see and write both repos without treating the parent itself as the git-aware execution root.

## Canonical Source Of Truth

The parent-level `AGENTS.md` and `CLAUDE.md` files are intentionally not versioned directly because they live outside `righelt-app`. Their tracked sources of truth live in:

- `docs/ai/WORKSPACE_ROOT_AGENTS.template.md`
- `docs/ai/WORKSPACE_ROOT_CLAUDE.template.md`

Agent rule:

- If you edit guidance that belongs in the parent workspace instructions, update the tracked template first, then run `pnpm setup:workspace` to regenerate the live parent `AGENTS.md` and `CLAUDE.md` files before you finish the task.

Generate or refresh the parent file with:

```bash
pnpm setup:workspace
```

## What The Setup Script Does

`scripts/setup-workspace.sh` is safe by default:

- validates that this repo is named `righelt-app`
- validates or creates the parent workspace root
- writes the parent `AGENTS.md` and `CLAUDE.md` from the tracked templates
- checks whether `../righelt-backlog` exists
- optionally clones `righelt-backlog` if it is missing

It does not automatically move an existing checkout.

## Common Usage

Refresh the parent `AGENTS.md` and `CLAUDE.md` files and validate layout:

```bash
pnpm setup:workspace
```

Refresh and clone the backlog repo if it is missing:

```bash
pnpm setup:workspace -- --clone-backlog
```

## Expected Result

After setup:

- the opened top-level folder should be the parent `righelt` workspace
- git-aware product work should still run from `righelt-app`
- prefer direct commands like `./scripts/git-app.sh ...`, `./scripts/backlog-sync.sh ...`, `./scripts/backlog-git.sh ...`, `./scripts/backlog.sh ...`, and `./scripts/backlog-doc.sh ...` over shell-wrapper command strings
- backlog operations from `righelt-app/scripts/backlog.sh`, `righelt-app/scripts/backlog-git.sh`, `righelt-app/scripts/backlog-sync.sh`, and `righelt-app/scripts/backlog-doc.sh` should resolve to the sibling `righelt-backlog` repo
