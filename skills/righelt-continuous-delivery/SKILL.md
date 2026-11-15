---
name: righelt-continuous-delivery
description: Drive an approved multi-PR Righelt delivery program through implementation, exact-head validation, merge, deployment, acceptance, cumulative product validation, and network hardening. Use for long ordered release batches, not an ordinary single PR.
---

# Righelt continuous delivery

Read `AGENTS.md`, then read [the continuous delivery standard](../../docs/ai/CONTINUOUS_DELIVERY_DOS_AND_DONTS.md) completely before acting.

## Outcome

Keep approved product work moving without duplicate owners, idle gaps, weakened gates, lost feedback, or unsafe production changes. Finish with every scoped task deployed and accepted, cumulative product and network campaigns complete, tracking reconciled, and owned resources cleaned.

## Core rules

- One coordinator writes the canonical register.
- Tasks own live status. Handoffs or contracts own approved requirements and acceptance. The canonical decision register at `../righelt-backlog/backlog/docs/ux-decisions/decision-delivery-register.json` owns approval-to-release receipts. One ignored `test-results/<program>-state/active.json` checkpoint owns only the current head, gate, next action, resources, and safety limits.
- Search for an existing owner before creating a task. Queue only approved outcomes. Use one canonical PR per coherent product or lifecycle contract.
- Advance the critical path and prepare the next independent group during review, CI, and deployment waits. Refresh successors once onto the actual deployed squash before merge.
- Run durability first, focused executed-behavior proof, bounded independent review, full exact-head `PR validation`, protected merge, exact served identity, and narrow production acceptance.
- Reuse unaffected evidence. Repair the underlying contract and rerun only invalidated proof plus the stable exact-head gate.
- Treat protected observers as fail-closed. Refresh exact bindings only after confirming the observed behavior, operations, privacy bounds, and guards remain correct.
- Update the task, register, and checkpoint at every material release boundary. Run `pnpm check:decision-register` at PR opening, before merge, and at final reconciliation.
- Use fresh test-owned production state and supported lifecycle actions. Preserve retained data and all separate activation, schema, account, model, publication, and rollout authority boundaries.
- Verify card or summary claims through the stricter authorized detail read. Do not treat application, authorization, or data-integrity failures as network transients. Retire sockets, recovery, polling, reminder, lease, and retry owners when their route, session, or generation ends.
- Run one cumulative product campaign after the batch, then the dedicated cross-browser network-hardening campaign.

## Progress discipline

Concrete implementation, diagnosis, tests, review, CI/deployment results, evidence, and acceptance are progress. Polling and active labels are not. When one lane blocks, diagnose it and redirect free capacity to independent product work. Use supervised resources and preserve unrelated runs, tabs, worktrees, branches, and evidence.

A heartbeat is opt-in. Reuse the matching automation, never duplicate it, and never resume a paused schedule without explicit user direction. It may wake this coordinator, but it never performs delivery or writes competing state. On wake, verify real receipts, stay quiet if work advances, and act only on a genuine gap.

Repository skill changes require review, exact-head validation, merge, and an explicit install or refresh before the installed skill is treated as released. Never substitute an unmerged candidate for pinned tooling.

Stop only for a required product decision, new authority, an all-lanes resource block after useful light work is exhausted, explicit pause, or completed scope.
