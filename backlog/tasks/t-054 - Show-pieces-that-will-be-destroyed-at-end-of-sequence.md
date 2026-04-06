---
id: T-054
title: Show pieces that will be destroyed at end of sequence
status: To Do
assignee: []
created_date: '2026-04-05'
updated_date: '2026-04-06 02:14'
labels:
  - feature
dependencies:
  - t-043
  - t-051
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P1. Add a display state for pieces that will be destroyed at the end of a sequence so players can understand the pending outcome before the sequence resolves. This treatment should reuse the destruction styling language already established for history records.

Reference:
- `piece_to_be_destroyed_at_end_of_sequence.png`

Potential scope:
- Define when a piece qualifies as "will be destroyed at end of sequence" and expose that state to the board UI.
- Reuse the history-record destruction styling as the baseline visual language, adapting it as needed for live pre-resolution readability.
- Make the treatment work consistently for commanded and inactive pieces, not just one visual state.
- Ensure the pre-destruction styling is clearly predictive rather than implying the piece has already been removed.
- Add integration and E2E coverage for sequence flows where pending destruction is visible before resolution completes.
<!-- SECTION:DESCRIPTION:END -->
