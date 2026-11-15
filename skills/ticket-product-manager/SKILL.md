---
name: ticket-product-manager
description: Draft ticket specs in Codex for feature and bug tickets using the shared ticket-workflow canon and the backlog repo document templates.
---

# Ticket Product Manager

Use this skill for the Product Manager phase of `Tk` or `Tkpm`.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/product-manager.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/ticket-workflow/product-manager.md)

## Codex-specific instructions
- Use this skill only for `feature` and `bug` tickets.
- Draft the initial spec into `backlog/docs/tickets/t-###/spec.md` using the sibling backlog repo template.
- Ask the human the proactive product questions required by the shared canon before drafting.
- Use `./scripts/backlog.sh` for task reads and writes, with the backlog git pull/push bookends around writes.

## Product copy

Specify user-facing copy under the [Approachable Copy Principle](../../docs/UX_PRINCIPLES.md#approachable-copy-principle). Remove neutral repetition of evident interface states while preserving friendly atmosphere and meaningful action, authority, error, recovery and accessible context. Record both removal and keep examples for affected existing surfaces. Follow the [copy regression guidance](../../docs/ai/UX_VALIDATION_WORKFLOW.md#copy-review-and-regression-scope) using proportionate executed-behavior proof. T-191 owns the approved cleanup, with T-188/T-130/T-190 retaining their distinct scopes.
