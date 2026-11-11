---
name: ticket-tester
description: Produce ticket test plans, gap consultations, and skeptical final-validation passes in Codex using the shared ticket-workflow canon.
---

# Ticket Tester

Use this skill for the Tester role in `plan-review`, `gap-consult`, or `final-validation` mode.

## Read First
- [docs/ai/TICKET_WORKFLOW.md](../../docs/ai/TICKET_WORKFLOW.md)
- [docs/ai/ticket-workflow/tester.md](../../docs/ai/ticket-workflow/tester.md)
- [docs/ai/UX_VALIDATION_WORKFLOW.md](../../docs/ai/UX_VALIDATION_WORKFLOW.md)

## Codex-specific instructions
- Require the caller to state the mode explicitly.
- In `plan-review`, write only `backlog/docs/tickets/t-###/test-plan.md`; do not implement code. Include a UX Proof Matrix when the ticket touches the user experience.
- In `gap-consult`, answer the concrete gap only, but you may answer "how do we prove this UX claim?" questions with targeted automation patterns.
- In `final-validation`, inspect the combined changeset with `git diff <base-branch>...HEAD` before drilling into full files.
- Keep output sections aligned with the shared canon so Lead and Architect can consume them without translation.

## Proportionate validation and evidence reuse

Follow `docs/ai/VALIDATION_EVIDENCE_POLICY.md` in the pinned released tools. Inspect `plan --candidate /absolute/path` before executing. New version 3 plans require a concrete acceptance or regression reason for every additional check and reuse compatible proof across runs. Keep the full stable current-head PR gate. Recheck only invalidated evidence after repairs, reuse unchanged review and images, and stop when acceptance questions are answered. Retained proof is required at affected state boundaries, not automatically for every feature. Within the authorized delivery order, implement, review, push and run CI for the next change while the preceding merge is in main CI or deployment verification. Only the next merge waits for required verification of the preceding deployment. Serialize local heavy jobs through the resource queue and preserve any explicit user wait command. Existing explicit acceptance, authorization, production-data protection and exact deployed identity remain required. CI narrowing is separate.

## Durable behavioral proof

Follow the durable testing standard in `docs/ai/TESTING_STRATEGY.md` in the pinned released tools. Test executed production behavior with independent expected answers. Migrate new and affected source-dependent assertions without expanding the frozen legacy inventory. Show targeted negative proof for migrated regressions, retain focused app wiring proof, and use native browser proof for native contracts. Run `check:test-durability` before slower checks. Leave unrelated legacy migration to T-136.
