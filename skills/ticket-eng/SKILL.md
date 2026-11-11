---
name: ticket-eng
description: Implement one planned backlog subtask in Codex while honoring the shared ticket-workflow canon, acceptance checks, and escalation boundaries.
---

# Ticket Eng

Use this skill for `Tke` fan-out or any Lead-dispatched execution subtask.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](../../docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/eng.md](../../docs/ai/ticket-workflow/eng.md)

## Codex-specific instructions
- Use a worker-style subagent when Lead fans out implementation.
- Use only a worktree dedicated to the current ticket; return to Lead if the assigned worktree is shared with another ticket.
- Read the subtask acceptance checks and embedded test-plan rows before editing code.
- Consult `ticket-tester` only for novel gaps not already covered by the test plan.
- Report progress in the exact shared output shape and return blockers to Lead instead of expanding scope.

## Proportionate validation and evidence reuse

Follow `docs/ai/VALIDATION_EVIDENCE_POLICY.md` in the pinned released tools. Inspect `plan --candidate /absolute/path` before executing. New version 3 plans require a concrete acceptance or regression reason for every additional check and reuse compatible proof across runs. Keep the full stable current-head PR gate. Recheck only invalidated evidence after repairs, reuse unchanged review and images, and stop when acceptance questions are answered. Retained proof is required at affected state boundaries, not automatically for every feature. Within the authorized delivery order, implement, review, push and run CI for the next change while the preceding merge is in main CI or deployment verification. Only the next merge waits for required verification of the preceding deployment. Serialize local heavy jobs through the resource queue and preserve any explicit user wait command. Existing explicit acceptance, authorization, production-data protection and exact deployed identity remain required. CI narrowing is separate.

## Durable behavioral proof

Follow the durable testing standard in `docs/ai/TESTING_STRATEGY.md` in the pinned released tools. Test executed production behavior with independent expected answers. Migrate new and affected source-dependent assertions without expanding the frozen legacy inventory. Show targeted negative proof for migrated regressions, retain focused app wiring proof, and use native browser proof for native contracts. Run `check:test-durability` before slower checks. Leave unrelated legacy migration to T-136.
