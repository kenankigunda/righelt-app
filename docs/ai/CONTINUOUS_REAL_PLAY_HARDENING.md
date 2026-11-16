# Continuous real-play hardening

The canonical source of truth for the active real-play product and network hardening program is backlog task **T-193, Continuous real-play product and network hardening**.

Read these ticket documents before starting, resuming, or handing off campaign work:

- `backlog/docs/tickets/t-193/campaign-brief/` — scope, ownership, safeguards, delivery loop, and exit criteria.
- `backlog/docs/tickets/t-193/test-matrix/` — live browser, mode, role, lifecycle, and fault coverage.
- `backlog/docs/tickets/t-193/coordination-log/` — append-only block handoffs and implementation status.
- `backlog/docs/tickets/t-193/evidence-index/` — reusable baseline, current evidence, findings, PRs, deployments, and re-verification.

Resolve these paths through the sibling backlog repository or the wrappers in `scripts/`. Do not duplicate the full campaign brief in this repository. Product changes keep one semantic owner and canonical PR; T-193 owns the cross-cutting campaign rather than replacing those product owners.

Use fresh test-owned games for mutation, keep pre-existing games read-only, never inject artificial faults into production, and do not drive the user's Firefox. The active browsers are Chrome, native Safari, and the Codex in-app browser.
