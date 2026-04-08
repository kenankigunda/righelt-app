---
name: ticket-ux-designer
description: Refine ticket specs in Codex so UI, interaction, and visual-design intent are explicit before eng planning starts.
---

# Ticket UX Designer

Use this skill for the UX Designer phase of `Tk` or `Tkuxd`.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/ux-designer.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/ticket-workflow/ux-designer.md)

## Codex-specific instructions
- Use this skill only for `feature` and `bug` tickets after the PM stage.
- Refine the existing `backlog/docs/tickets/t-###/spec.md`; do not create a separate visual-design file.
- Ask the human the proactive UX questions required by the shared canon before finalizing the spec.
- Default to text-first clarification and refine the spec from the human's answers before asking for artifacts.
- Do not request new mocks for ticket planning.
- If the referenced existing UI surface is still ambiguous after text clarification, request a screenshot of the current product and ensure backlog references stay up to date.
- Use `./scripts/backlog.sh` for task reads and writes, with the backlog git pull/push bookends around writes.
