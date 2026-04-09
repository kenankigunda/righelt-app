# Ticket Workflow Canon

This directory is the shared, tool-agnostic canon for the ticket workflow described in [docs/ai/TICKET_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/TICKET_WORKFLOW.md).

It is authoritative for teammate responsibilities across both supported clients:

- Claude wrappers: `.claude/agents/*.md`
- Codex skills: `skills/ticket-*/SKILL.md`

Use these role docs when updating the workflow:

- `lead.md`
- `product-manager.md`
- `ux-designer.md`
- `architect.md`
- `eng.md`
- `tester.md`

Client-specific adapters should stay thin. They may add only invocation details such as teammate tool usage, subagent wiring, or client-specific prompt scaffolding. They should not redefine workflow ownership, phase boundaries, status rules, or output contracts.
