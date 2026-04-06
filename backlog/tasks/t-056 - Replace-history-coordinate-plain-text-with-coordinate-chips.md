---
id: T-056
title: Replace history coordinate plain text with coordinate chips
status: To Do
assignee: []
created_date: '2026-04-05'
updated_date: '2026-04-06 02:14'
labels:
  - feature
dependencies:
  - t-001
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P3. Replace plain-text coordinate tuples such as `(5,4)` in the history panel with coordinate chips so board locations read more clearly and consistently inside move and destruction records.

Potential scope:
- Define a reusable coordinate-chip treatment for history metadata that can be applied to both move notation and destruction records where appropriate.
- Ensure the chip styling works with player-tone coloring, undone styling, and nested history rows without breaking the existing visual rhythm.
- Decide whether chips should be purely typographic or include a subtle board-location affordance while remaining compact.
- Keep the history panel readable on narrow layouts and avoid chips that cause awkward line wrapping or spacing regressions.
- Add unit and E2E coverage for the history rendering contract so coordinate chips remain stable through future UI iterations.
<!-- SECTION:DESCRIPTION:END -->
