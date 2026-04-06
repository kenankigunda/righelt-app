# Plan: Move Backlog to a Shared Git Repo

## Context
The backlog currently lives inside `righelt/backlog/`, tracked by the main repo's git history.
Each worktree gets its own diverging copy of task files as branches evolve independently.
This means:
- No unified view of all in-flight work across worktrees
- A task's connection to its progressing branch/worktree is implicit
- Ticket status edits in one branch are invisible to other threads

**Goal**: Extract the backlog into a dedicated `righelt-backlog` git repo (sibling to the main repo)
with a single `main` branch. All worktrees share it via a wrapper script that resolves the path
dynamically — no hardcoded paths anywhere. Tasks explicitly record which branch + worktree are
driving them.

**Confirmed**: `backlog mcp start` supports `--cwd <path>` to override where it looks for the
backlog root. This is the mechanism used to redirect all worktrees to the shared repo.

---

## Step 1 — Create the shared backlog repo

Create `righelt-backlog` as a sibling to `righelt` (same parent directory). Seed from the latest
`main` to capture the current normalized task filenames (slug format, hyphens, 73 tasks):

```bash
cd <parent-of-righelt>
git -C righelt pull origin main          # ensure we're seeding from latest
mkdir righelt-backlog
cd righelt-backlog
git init -b main
cp -r ../righelt/backlog/. .
git add -A
git commit -m "Import backlog from righelt (seeded from main @ <commit>)"
```

Update `config.yml` in the new repo:
- `auto_commit: true` — MCP auto-commits each write locally (currently `false`, needs changing)
- `check_active_branches: false` — irrelevant in a single-branch repo (currently `true`)

---

## Step 2 — Add wrapper script for dynamic path resolution

Create `scripts/backlog-mcp-start.sh` in the main repo. This script resolves the backlog path
relative to the main repo root at runtime — no hardcoded paths:

```bash
#!/usr/bin/env bash
# Resolves the shared backlog repo as a sibling of the main repo,
# regardless of whether we're in the main repo or a worktree.

# git-common-dir points to the main repo's .git (works from worktrees too)
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)

if [[ "$GIT_COMMON" == ".git" ]]; then
  # We're in the main repo root
  MAIN_REPO="$(git rev-parse --show-toplevel)"
else
  # We're in a worktree; strip /.git suffix to get main repo root
  MAIN_REPO="${GIT_COMMON%/.git}"
fi

BACKLOG_CWD="$(dirname "$MAIN_REPO")/righelt-backlog"
exec backlog mcp start --cwd "$BACKLOG_CWD" "$@"
```

Commit this script to the main repo so it's available in all worktrees automatically.

---

## Step 3 — Reconfigure the MCP registration

Replace the existing `backlog mcp start` registration with the wrapper script.
The MCP is currently registered at the project level. Update it:

```bash
claude mcp remove backlog
claude mcp add backlog -- ./scripts/backlog-mcp-start.sh
```

If Claude Code stores this as an absolute path, use the project-scoped MCP config in
`.claude/settings.json` instead (adding under `mcpServers`):

```json
"mcpServers": {
  "backlog": {
    "command": "bash",
    "args": ["<absolute-path-to>/scripts/backlog-mcp-start.sh"]
  }
}
```

The script itself is the only thing that holds an absolute path, and it computes the backlog
location relative to the main repo at runtime — so moving both repos together requires only
re-registering the MCP (or updating the one path in settings.json).

---

## Step 4 — Remove backlog from the main repo

```bash
# From the main repo root:
git rm -r --cached backlog/
echo "backlog/" >> .gitignore
git add .gitignore
git commit -m "Remove backlog from repo — now lives in sibling righelt-backlog repo"
```

The `backlog/` directory is deleted from git history going forward. The external repo holds all
current task state.

---

## Step 5 — Migrate ticket docs into the backlog repo

**Recommendation: move all ticket docs under `backlog/docs/tickets/t-###/`.**

Three options were considered:

| Option | Verdict |
|--------|---------|
| A. `backlog/docs/tickets/t-###/` | **Recommended** — `backlog/docs/` already reserved; all ticket data in one repo; `references` stay self-relative |
| B. Keep in `docs/tickets/` (main repo) | Breaks goal — docs diverge per branch, coordination-log is not shared |
| C. Separate path in backlog repo | Same as A but with a new path convention — no benefit |

**What moves** (seeded into the backlog repo during Step 1):
- `docs/tickets/t-###/spec.md` → `backlog/docs/tickets/t-###/spec.md`
- `docs/tickets/t-###/eng-plan.md` → `backlog/docs/tickets/t-###/eng-plan.md`
- `docs/tickets/t-###/test-plan.md` → `backlog/docs/tickets/t-###/test-plan.md`
- `docs/tickets/t-###/coordination-log.md` → `backlog/docs/tickets/t-###/coordination-log.md`
- `docs/tickets/SPEC_TEMPLATE.md` → `backlog/docs/SPEC_TEMPLATE.md`
- `docs/tickets/ENG_PLAN_TEMPLATE.md` → `backlog/docs/ENG_PLAN_TEMPLATE.md`

The `references` field format stays the same (`docs/tickets/t-###/spec.md`) — now relative to
the backlog repo root rather than the main repo root. No task file edits needed.

**What stays in main repo**: `docs/tickets/` is removed and `.gitignore`'d. Agents writing
spec/eng-plan/test-plan files must write them to the backlog repo path, not the main repo. The
workflow docs make this explicit (Step 7 below).

**After migration, remove from main repo:**
```bash
git rm -r docs/tickets/
echo "docs/tickets/" >> .gitignore
git add .gitignore
git commit -m "Remove docs/tickets — now lives in righelt-backlog/docs/tickets"
```

---

## Step 5b — Add branch/worktree fields to tasks

No schema change needed in `config.yml`. These become optional frontmatter fields set by the Lead:

```yaml
branch: "claude/funny-mayer"    # set when ticket → In Progress
worktree: "funny-mayer"         # cleared (or kept as audit trail) when → Done
```

Workflow convention added to `TICKET_WORKFLOW.md`:
- **Step 4 (Lead fans out Eng subtasks)**: `task_edit` to add `branch` + `worktree` on the parent ticket
- **Step 5d (Ready for acceptance)**: `task_edit` to clear `branch` + `worktree`

---

## Step 6 — Add sync discipline to agent workflows

The sync wrapper applies to **all three write paths** (MCP → CLI → direct file edit):
- **Pull before write** — avoid conflicts with other worktrees
- **Push after write** — make the change visible to all worktrees

Add `scripts/backlog-git.sh` for easy invocation from any worktree:

```bash
#!/usr/bin/env bash
# scripts/backlog-git.sh — run git commands against the shared backlog repo
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null)
[[ "$GIT_COMMON" == ".git" ]] && MAIN_REPO="$(git rev-parse --show-toplevel)" \
  || MAIN_REPO="${GIT_COMMON%/.git}"
BACKLOG_REPO="$(dirname "$MAIN_REPO")/righelt-backlog"
git -C "$BACKLOG_REPO" "$@"
```

### Write path protocol (all three paths use the same bookends)

**Path 1 — MCP (preferred)**
```
./scripts/backlog-git.sh pull --rebase origin main
<MCP tool call: task_edit / task_create / task_complete>
./scripts/backlog-git.sh push origin main
```
`auto_commit: true` handles the local commit; only push is needed after.

**Path 2 — backlog CLI (fallback when MCP unavailable)**
```
./scripts/backlog-git.sh pull --rebase origin main
backlog task edit t-### ...     # CLI respects auto_commit, commits locally
./scripts/backlog-git.sh push origin main
```

**Path 3 — direct file edit (last resort)**
```
./scripts/backlog-git.sh pull --rebase origin main
# Edit backlog/tasks/t-### - <slug>.md directly
# Follow filename convention: t-### - Hyphenated-slug.md
./scripts/backlog-git.sh commit -am "chore(backlog): update t-### <short reason>"
./scripts/backlog-git.sh push origin main
```
On direct edit, the agent must commit manually since auto_commit only fires via the CLI.

**Conflict policy**: task files are one file per ID, so concurrent edits to different tickets
never conflict. If two agents edit the same task concurrently, the second push fails — that
agent should `pull --rebase` and re-attempt the write (whichever path it used).

---

## Step 7 — Update documentation

**`AGENTS.md`** — the §7 backlog section already has CLI slug/filename hygiene from commit 050112d.
Append to that section (don't replace existing content):
```
The backlog lives in a sibling repo (../righelt-backlog relative to this repo), always on main.

Write path (preference order: MCP > CLI > direct file edit — same bookends for all):
  Before write:  ./scripts/backlog-git.sh pull --rebase origin main
  After write:   ./scripts/backlog-git.sh push origin main
  Direct edit only: also commit manually with backlog-git.sh commit -am "..."

Use `branch` + `worktree` frontmatter fields to record where active work is happening.
```

**`docs/ai/TICKET_WORKFLOW.md`** — update throughout:
- Replace all references to `docs/tickets/t-###/` with `<backlog-repo>/docs/tickets/t-###/`
  (make explicit that these files are written to the backlog repo, not the main repo)
- Replace template references (`docs/tickets/SPEC_TEMPLATE.md`) with `<backlog-repo>/docs/SPEC_TEMPLATE.md`
- Extend "Backlog Hygiene" section: add write path degradation (MCP → CLI → direct edit) with sync bookends
- Step 4: Lead sets `branch` + `worktree` fields when moving ticket → In Progress
- Step 5d: Lead clears `branch` + `worktree` when moving → Ready for acceptance

For agents, `<backlog-repo>` is derived via the same logic as `backlog-git.sh`:
`$(dirname "$(git rev-parse --git-common-dir | sed 's|/.git||')")/righelt-backlog`
or simply: sibling of the main repo.

---

## Files to create
| File | Purpose |
|------|---------|
| `<parent>/righelt-backlog/` | New dedicated backlog repo seeded from `backlog/` + `docs/tickets/` |
| `scripts/backlog-mcp-start.sh` | MCP wrapper — resolves backlog path dynamically |
| `scripts/backlog-git.sh` | Git helper — runs git commands against the backlog repo |

## Files to modify
| File | Change |
|------|--------|
| `AGENTS.md` | §7: backlog location, sync protocol, branch/worktree field convention |
| `docs/ai/TICKET_WORKFLOW.md` | All `docs/tickets/` → backlog-repo paths; sync bookends; Steps 4 + 5d |
| `.gitignore` | Add `backlog/` and `docs/tickets/` |
| `backlog/config.yml` → moved to backlog repo | `auto_commit: true`, `check_active_branches: false` |
| MCP registration | Point to `scripts/backlog-mcp-start.sh` |

## Files to remove from main repo
| File | Reason |
|------|--------|
| `backlog/` | Moved to backlog repo; git-untracked + gitignored |
| `docs/tickets/t-###/` | Moved to `backlog/docs/tickets/t-###/` in backlog repo |
| `docs/tickets/SPEC_TEMPLATE.md` | Moved to `backlog/docs/SPEC_TEMPLATE.md` |
| `docs/tickets/ENG_PLAN_TEMPLATE.md` | Moved to `backlog/docs/ENG_PLAN_TEMPLATE.md` |

---

## Verification
1. Restart Claude Code in two different worktrees; call `task_list` in each — both show identical results
2. In worktree A: `task_edit t-001` → push via `backlog-git.sh push origin main`
3. In worktree B: `backlog-git.sh pull --rebase origin main` → `task_view t-001` shows the update
4. `git status` in the main repo shows `backlog/` and `docs/tickets/` as untracked/ignored
5. `git log` in `righelt-backlog` shows a clean linear history on `main`
6. Confirm spec/eng-plan/test-plan for an existing ticket are visible at `backlog/docs/tickets/t-###/` in the backlog repo
7. Move both repos to a new parent directory; verify the wrapper script still resolves correctly without any config changes
