# T-001 Coordination Log — History destruction record

## 2026-04-04 — Step 1: Assignment

- Phase: Spec
- Lead assigned; status set to `Spec`
- Routing: `feature` → PO → Architect
- Backlog MCP unavailable; task file edited directly as fallback per AGENTS.md §2
- Next: Spawn `product-owner` for full spec

## 2026-04-04 — Step 2: PO Spec Complete

- Phase: Planning
- Spec written: `docs/tickets/t-001/spec.md` (full spec)
- Key decisions:
  - Supply/command records out of scope — destruction records only
  - Sub-bullets non-jumpable and subordinate to the parent move row
  - Format: `DESTROYED (x,y)` per removed piece, colored by piece owner seat
  - Draw case: both Commander records appear under same triggering move
  - Board contract extended: `moveSent` payload carries persistent `destroyedPieces` array
  - Selected history move owns board presentation; no separate destruction-row navigation surface
  - §12.3 tooltip kept; persistence explicitly in scope
- Status set to `Planning`
- Next: Spawn `architect`

## 2026-04-04 — Step 3: Architect Complete

- Phase: In Progress
- Eng plan: `docs/tickets/t-001/eng-plan.md`
- Test plan: `docs/tickets/t-001/test-plan.md`
- 6 subtasks created: t-001.01–t-001.06
- WIP limit: 2 parallel streams
- Execution order: [t-001.01 ∥ t-001.03] → t-001.02 → t-001.04 → t-001.05 → t-001.06
- Risks noted: dual `collectRemovedPieceNotices` sync (U-17 guards), `withViewModel` stripping check
- Status set to `In Progress`
- Next: Fan out t-001.01 and t-001.03 in parallel

## 2026-04-04 — Step 4: All Eng Subtasks Complete

- t-001.01 ✅ 13 tests (U-01–U-06, U-17)
- t-001.02 ✅ 15 tests (U-07–U-09, I-01–I-10, I-19)
- t-001.03 ✅ 4 tests (U-10–U-12, UX-07)
- t-001.04 ✅ 9 tests (U-13–U-16, I-13, UX-03, UX-08)
- t-001.05 ✅ 16 tests (I-14–I-18, UX-01–UX-05); finalized parent-row-owned history selection and passive destruction rows
- t-001.06 ✅ I-11, I-12 added; E-01–E-06 Playwright specs created; WORKFLOW_COVERAGE.md updated
- Full pass: 359 web + 114 api-handler, 0 failures
- Next: Spawn `tester` for final validation pass

## 2026-04-04 — Step 5: Final Tester Validation — PASS

- All 15 ACs verified
- Final UX validated: parent move selection owns history navigation, and selected destruction-bearing moves render recorded-action destruction overlays on the board without a separate `jump-destruction` path
- Remaining non-blocking risks: draw integration gap (unit-covered), focus ring gap (pre-existing)
- Status set to `Done`
- 359 web tests + 114 api-handler tests, 0 failures
