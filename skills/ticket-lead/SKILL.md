---
name: ticket-lead
description: Coordinate the full ticket lifecycle or sprint workflow in Codex using the shared ticket-workflow canon, the sibling righelt-backlog repo, and the existing backlog wrapper scripts.
---

# Ticket Lead

Use this skill for `Tk`, `Tke`, `Tkv`, `Ps`, and `Es`.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/lead.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/ticket-workflow/lead.md)

## Codex-specific instructions
- Stay in the parent agent as Lead.
- Before the first workflow action, run `node scripts/check-ticket-workflow-setup.mjs`.
- Use `spawn_agent` for teammate dispatch:
  - `ticket-product-manager`, `ticket-ux-designer`, and `ticket-architect` run sequentially for `feature` and `bug` tickets.
  - `ticket-eng` runs in parallel up to the eng-plan WIP limit.
  - `ticket-tester` runs only when the workflow explicitly calls for it.
- Ensure the ticket has a dedicated execution worktree before Eng fan-out, and do not reuse that worktree for another active ticket.
- Pass only the ticket or subtask ID, required mode, and the relevant skill reference to subagents. Do not paste file contents into subagent prompts.
- Use `./scripts/backlog.sh` for task operations and `./scripts/backlog-git.sh` for the required pull/push bookends around every backlog write.
- Write ticket-authored documents into the sibling backlog repo, not this repo.
