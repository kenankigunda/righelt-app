---
id: T-085
title: Expand Debug panel info and improve its information architecture
status: To Do
assignee: []
created_date: '2026-04-06 03:22'
labels:
  - improvement
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P3.

Improve the Debug panel so it exposes more useful runtime/debugging information while also cleaning up how that information is organized and presented. The goal is not only to add more data, but to make the panel easier to scan, understand, and use during investigation and development.

Potential scope:
- Audit the current Debug panel content and identify the most important missing information for debugging live issues, state transitions, network/sync behavior, scenario launches, and board/runtime state.
- Reorganize the panel so related information is grouped more clearly, with a stronger visual hierarchy and less cognitive overhead when scanning.
- Reduce clutter, duplication, or awkward placement that makes the current panel harder to use than necessary.
- Clarify which information is most important for quick diagnosis versus deeper inspection, and reflect that in the layout and labeling.
- Add or update regression coverage for the Debug panel structure/content contract where appropriate so future additions do not degrade usability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The Debug panel exposes additional information that is materially useful for debugging real app behavior or failures.
- [ ] #2 The Debug panel information architecture is clearer, with related information grouped and labeled in a way that improves scanability and comprehension.
- [ ] #3 The updated panel avoids adding information in a way that makes the UI noisier or harder to use overall.
- [ ] #4 Relevant validation or regression coverage is updated so the improved Debug panel structure remains stable.
<!-- AC:END -->
