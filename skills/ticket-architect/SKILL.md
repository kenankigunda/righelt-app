---
name: ticket-architect
description: Produce Codex eng plans, test-plan handoffs, and backlog subtasks from the shared ticket-workflow canon for the Eng Planning phase.
---

# Ticket Architect

Use this skill for `Tka` or the Architect phase of `Tk`.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/architect.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/ticket-workflow/architect.md)
- [docs/ai/UX_VALIDATION_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/UX_VALIDATION_WORKFLOW.md)

## Codex-specific instructions
- Use `ticket-tester` once in `plan-review` mode before finalizing the eng plan.
- Treat the UX-refined `spec.md` as the binding planning input.
- For UX-sensitive tickets, include the automation hooks Tester will need, such as deterministic states, stable zone attributes, and user-timing marks where the UX contract depends on timing.
- Save `eng-plan.md` and `test-plan.md` into the sibling backlog repo.
- Use `./scripts/backlog.sh` to create subtasks and update the parent task, with required pull/push bookends around writes.
- If multi-stream execution is warranted, create `docs/features/<feature-id>/plan.yaml` in this repo and keep the backlog task linked to it.
