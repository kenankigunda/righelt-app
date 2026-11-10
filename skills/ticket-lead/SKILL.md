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
  - Use `ticket-product-manager`, `ticket-ux-designer`, `ticket-architect`, `ticket-eng`, and `ticket-tester` according to the shared canon in [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md) and [docs/ai/ticket-workflow/lead.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/ticket-workflow/lead.md).
- Pass only the ticket or subtask ID, required mode, and the relevant skill reference to subagents. Do not paste file contents into subagent prompts.

## Proportionate validation and evidence reuse

Follow `docs/ai/VALIDATION_EVIDENCE_POLICY.md` in the pinned released tools. Inspect `plan --candidate /absolute/path` before executing. New version 3 plans require a concrete acceptance or regression reason for every additional check and reuse compatible proof across runs. Keep the full stable current-head PR gate. Recheck only invalidated evidence after repairs, reuse unchanged review and images, and stop when acceptance questions are answered. Retained proof is required at affected state boundaries, not automatically for every feature. Continue independent work while required CI runs unless the user explicitly requested waiting. Existing explicit acceptance, authorization, production-data protection and exact deployed identity remain required. CI narrowing is separate.
