---
id: T-092
title: Make mobile board-view panel scrolling feel more natively continuous
status: To Do
assignee: []
created_date: '2026-04-06 03:45'
labels:
  - feature
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P2.

Improve the way scrolling between panels works in the mobile board view so that users can see the motion between panels as the scroll happens, making the interaction feel more mobile-native and spatially continuous.

The goal is to avoid panel transitions that feel overly abrupt, disconnected, or invisible during the gesture. Instead, the user should feel the relationship between adjacent panels while scrolling/swiping between them.

Potential scope:
- Revisit the current mobile panel transition behavior for board-view panel navigation.
- Make panel-to-panel motion visible during the interaction rather than only after a threshold or jump.
- Improve the sense of continuity, touch directness, and spatial feedback so the interaction feels more like a native mobile surface.
- Balance motion clarity with responsiveness and avoid introducing jank, lag, or over-animated behavior.
- Add or update regression coverage for the intended mobile panel-motion contract where appropriate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 On mobile board view, users can perceive the motion between adjacent panels as they scroll or swipe between them.
- [ ] #2 The panel transition feels more continuous and mobile-native rather than abrupt or disconnected.
- [ ] #3 The improved motion does not introduce regressions in responsiveness, control, or panel navigation correctness.
- [ ] #4 Relevant validation or regression coverage is updated for any concrete mobile panel-transition behavior that should remain stable.
<!-- AC:END -->
