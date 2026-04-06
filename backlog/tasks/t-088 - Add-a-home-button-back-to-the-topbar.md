---
id: T-088
title: Add a home button back to the topbar
status: To Do
assignee: []
created_date: '2026-04-06 03:34'
updated_date: '2026-04-06 03:42'
labels:
  - feature
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P1.

Add a dedicated home button back to the topbar/header so users have a clear, explicit way to return to the home screen from top-level app chrome.

This should be treated as part of a broader refinement of the header overall rather than as a single isolated button addition. In particular, the current `Scenarios` and `Debug` buttons should be collapsed into a hamburger/menu-style treatment in all views, or replaced with another similarly intentional header pattern that simplifies and improves the top-level header information architecture.

The goal is to restore an obvious topbar-level home action while also making the header feel cleaner, more coherent, and more intentionally organized.

Potential scope:
- Define where the home button should live in the header across relevant routes and responsive layouts.
- Collapse `Scenarios` and `Debug` into a hamburger/menu treatment in all views, or establish another header treatment that achieves a similarly improved overall result.
- Ensure the home affordance is clearly recognizable as a home action rather than relying on users to infer navigation from branding or other UI elements.
- Refine the overall header structure so top-level actions are better grouped and the header feels less cluttered.
- Decide how the restored home action should behave alongside any remaining title-link or menu-based navigation affordances.
- Add regression coverage so the intended header actions remain present and wired correctly in the new top-level header design.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The header includes a clear dedicated home action in the intended user-facing contexts.
- [ ] #2 Scenarios and Debug are no longer exposed as separate top-level buttons in all views; they are consolidated into a hamburger/menu treatment or another similarly improved header pattern.
- [ ] #3 The refined header feels more coherent and less cluttered while preserving access to the same top-level functionality.
- [ ] #4 The restored home action and the refined header controls work coherently across responsive layouts.
- [ ] #5 Relevant validation or regression coverage is updated so the intended header actions remain present and correctly wired.
<!-- AC:END -->
