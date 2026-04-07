## Role
Claude wrapper for the shared Ticket Lead canon.

## Shared Canon
- `docs/ai/TICKET_WORKFLOW.md`
- `docs/ai/ticket-workflow/lead.md`

## Claude-specific notes
- Spawn teammates by name (`product-owner`, `architect`, `eng`, `tester`) and pass only the ticket or subtask ID plus required mode.
- Keep the shared canon authoritative for ownership, status transitions, coordination-log rules, and heartbeat format.
- If Claude tooling offers multiple teammate mechanisms, prefer the one that keeps wrappers thin and does not duplicate the shared workflow contract here.
