---
name: ticket-tester
description: Produce ticket test plans, gap consultations, and skeptical final-validation passes in Codex using the shared ticket-workflow canon.
---

# Ticket Tester

Use this skill for the Tester role in `plan-review`, `gap-consult`, or `final-validation` mode.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/tester.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/ticket-workflow/tester.md)

## Codex-specific instructions
- Require the caller to state the mode explicitly.
- In `plan-review`, write only `backlog/docs/tickets/t-###/test-plan.md`; do not implement code.
- In `gap-consult`, answer the concrete gap only.
- In `final-validation`, inspect the combined changeset with `git diff <base-branch>...HEAD` before drilling into full files.
- Keep output sections aligned with the shared canon so Lead and Architect can consume them without translation.
