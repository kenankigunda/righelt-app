---
id: T-083
title: Move backlog to a shared sibling git repo
status: To Do
assignee: []
created_date: '2026-04-06 03:02'
updated_date: '2026-04-06 03:05'
labels:
  - improvement
dependencies: []
references:
  - docs/tickets/t-083/eng-plan.md
priority: high
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 task_list returns identical results from two different worktrees
- [ ] #2 Status edit in worktree A is visible in worktree B after pull
- [ ] #3 git status in main repo shows backlog/ and docs/tickets/ as ignored
- [ ] #4 Spec/eng-plan/test-plan for existing tickets visible at backlog/docs/tickets/t-###/
- [ ] #5 Wrapper script resolves correctly after moving both repos to a new parent directory
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Create righelt-backlog repo as sibling of righelt; seed from backlog/ + docs/tickets/; set auto_commit: true, check_active_branches: false
2. Add scripts/backlog-mcp-start.sh — dynamically resolves backlog path via git rev-parse --git-common-dir, calls backlog mcp start --cwd <path>
3. Reconfigure MCP registration to point at the wrapper script
4. Remove backlog/ from main repo (git rm --cached, add to .gitignore)
5. Migrate docs/tickets/ → backlog/docs/tickets/; templates → backlog/docs/; remove from main repo
6. Add branch + worktree frontmatter fields — set by Lead on → In Progress, cleared on → Ready for acceptance
7. Add scripts/backlog-git.sh — runs git commands against backlog repo from any worktree
8. Sync discipline for all write paths (MCP > CLI > direct edit): pull --rebase before, push after; direct edit also needs manual commit
9. Update AGENTS.md §7 — backlog location, sync protocol, write-path degradation, branch/worktree fields
10. Update docs/ai/TICKET_WORKFLOW.md — all docs/tickets/ refs → backlog-repo paths; sync bookends in Backlog Hygiene; Steps 4 + 5d
<!-- SECTION:PLAN:END -->
