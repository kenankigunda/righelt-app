---
id: "t-053"
title: "End-of-sequence destruction does not animate"
status: "To Do"
assignee: []
created_date: "2026-04-05"
updated_date: "2026-04-05"
labels: ["bug"]
priority: "urgent"
dependencies: ["t-044"]
---

## Description
Notion priority: P0. Pieces destroyed at the end of a sequence are currently removed without the expected destruction animation, creating an inconsistent and harder-to-read transition compared with other destruction paths.

Reference:
- `piece_to_be_destroyed_at_end_of_sequence.png`

Potential scope:
- Diagnose why end-of-sequence destruction skips the live destruction animation path.
- Ensure destruction caused by end-of-sequence resolution uses the same animation contract as other live destruction events where appropriate.
- Verify the animation timing still works correctly with continuation closure, optimistic updates, and authoritative reconciliation.
- Add regression coverage for sequence-ending destruction so this path cannot silently lose its animation again.
