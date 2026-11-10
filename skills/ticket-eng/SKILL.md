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
- Use only a worktree dedicated to the current ticket; return to Lead if the assigned worktree is shared with another ticket.
- Read the subtask acceptance checks and embedded test-plan rows before editing code.
- Consult `ticket-tester` only for novel gaps not already covered by the test plan.
- Report progress in the exact shared output shape and return blockers to Lead instead of expanding scope.

## Proportionate validation and evidence reuse

Follow `docs/ai/VALIDATION_EVIDENCE_POLICY.md` in the pinned released tools. Inspect `plan --candidate /absolute/path` before executing. New version 3 plans require a concrete acceptance or regression reason for every additional check and reuse compatible proof across runs. Keep the full stable current-head PR gate. Recheck only invalidated evidence after repairs, reuse unchanged review and images, and stop when acceptance questions are answered. Retained proof is required at affected state boundaries, not automatically for every feature. Continue independent work while required CI runs unless the user explicitly requested waiting. Existing explicit acceptance, authorization, production-data protection and exact deployed identity remain required. CI narrowing is separate.
