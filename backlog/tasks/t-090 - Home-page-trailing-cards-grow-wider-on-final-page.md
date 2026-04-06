---
id: T-090
title: Home page trailing cards grow wider on final page
status: To Do
assignee: []
created_date: '2026-04-06 03:40'
labels:
  - bug
dependencies: []
references:
  - backlog/assets/home-page-trailing-game-size-inconsistency.png
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P3.

Observed behavior: on the home page, the final page of a paginated section can contain fewer game cards, and those trailing cards become wider than the cards on fuller pages.

Expected behavior: game cards should keep the same width they have on fuller pages, with the remaining horizontal space left empty rather than redistributed into wider trailing cards.

This appears to be a layout consistency bug in the home-page section/card sizing behavior for partially filled final pages.

Potential scope:
- Identify why the final partially filled page allows cards to expand wider than the normal home-page card width.
- Adjust the layout so card width remains consistent across pages, even when the last page has fewer items.
- Preserve the intended spacing/gap behavior and avoid regressions across responsive widths.
- Add regression coverage for home-page card sizing/layout consistency across full and partially filled pages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Home-page game cards keep a consistent width across paginated pages, including the final partially filled page.
- [ ] #2 On the final page, leftover horizontal space remains empty rather than causing trailing cards to grow wider than normal.
- [ ] #3 The layout remains visually stable and consistent across relevant responsive widths after the fix.
- [ ] #4 Relevant regression coverage is updated so this trailing-card size inconsistency does not return silently.
<!-- AC:END -->
