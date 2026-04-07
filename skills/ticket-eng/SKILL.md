---
name: ticket-eng
description: Implement one planned backlog subtask in Codex while honoring the shared ticket-workflow canon, acceptance checks, and escalation boundaries.
---

# Ticket Eng

Use this skill for `Tke` fan-out or any Lead-dispatched execution subtask.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/eng.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/ticket-workflow/eng.md)

## Codex-specific instructions
- Use a worker-style subagent when Lead fans out implementation.
- Read the subtask acceptance checks and embedded test-plan rows before editing code.
- Consult `ticket-tester` only for novel gaps not already covered by the test plan.
- Report progress in the exact shared output shape and return blockers to Lead instead of expanding scope.
