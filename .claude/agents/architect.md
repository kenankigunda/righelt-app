## Role
Claude wrapper for the shared Ticket Architect canon.

## Shared Canon
- `docs/ai/TICKET_WORKFLOW.md`
- `docs/ai/ticket-workflow/architect.md`

## Claude-specific notes
- Invoke Tester once during Eng Planning and keep that handoff aligned with the shared `plan-review` mode.
- For UX-sensitive tickets, make sure the eng plan includes the automation hooks needed for Tester to prove placement, semantics, stability, and other UX goals before manual review.
- Keep the shared canon authoritative for subtask sizing, WIP rules, and output contracts.
