# Coordination Log — T-030: Ability to leave games / delete if last player

## 2026-04-04 — Phase: Spec

**Action**: Ticket assigned to Lead. Status advanced to `Spec`. Routing: `feature` → PO + Architect.

**Next**: Spawn `product-owner` agent for spec + human checkpoint.

## 2026-04-04 — Phase: Planning

**Action**: PO spec complete (`docs/tickets/t-030/spec.md`). 20 ACs written. Status advanced to `Planning`.

**Key decisions**: Delete/Leave label logic; no confirmation; soft delete to Trash bin; blocking overlays for post-leave states; immediate rejoin without approval; Viewer leave returns to join-decision screen; offline disabled; new "Game not found" shell state.

**Next**: Spawn `architect` agent for eng plan + test plan.

## 2026-04-04 — Phase: Ready for execution

**Action**: Architect phase complete. Status advanced to `Ready for execution`.

**Decisions**: Soft-delete via `deletedAt` flag in `state_json` + `deleted_at` column on `live_games` (Option A). Trash bin as new `#/trash` hash route (Option A). Label logic computed client-side via pure `computeLeaveDeleteLabel` function. Inline `renderCardMenu` helper (no premature abstraction).

**Subtasks**: t-030.01 through t-030.08. Max 3 parallel streams.
- Round 1 (parallel): t-030.01, t-030.04
- Round 2 (parallel): t-030.02, t-030.03
- Round 3: t-030.05, then t-030.06 ∥ t-030.07
- Round 4: t-030.08

**Followup**: T-082 created — background job to hard-delete games soft-deleted for N+ days (P1, improvement).

**Next**: Awaiting `Es` (execution sprint) or `Tke t-030` to fan out Eng subtasks.
