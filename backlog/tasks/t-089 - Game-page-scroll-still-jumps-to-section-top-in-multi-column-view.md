---
id: T-089
title: Game page scroll still jumps to section top in multi-column view
status: To Do
assignee: []
created_date: '2026-04-06 03:37'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P1.

Observed behavior: in the multi-column game-page layout, page scrolling still appears to jump to the top of a game-page section. That behavior is undesirable in the multiple-column view.

Expected behavior: this kind of section-top jump/snap behavior should exist only in the single-column view where stacked sections may need stronger scroll targeting. In the multiple-column layout, scrolling should feel stable and should not unexpectedly jump the user to the top of a section.

Potential scope:
- Identify what logic is still triggering section-top scroll jumps in the multi-column game-page layout.
- Separate the single-column and multi-column scroll behaviors more cleanly so the jump behavior is limited to the intended layout only.
- Verify whether the issue is caused by resize/layout-mode transitions, route/render effects, focus/selection behavior, panel targeting, or explicit scroll restoration logic.
- Add regression coverage so multi-column game-page scrolling remains stable while preserving the intended single-column behavior.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 In the multi-column game-page layout, scrolling no longer unexpectedly jumps the user to the top of a section.
- [ ] #2 Any section-top scroll targeting behavior that should remain is limited to the intended single-column view only.
- [ ] #3 The fix preserves the intended navigation/scroll behavior for single-column layouts while improving multi-column stability.
- [ ] #4 Relevant regression coverage is updated so multi-column scroll stability does not regress silently.
<!-- AC:END -->
