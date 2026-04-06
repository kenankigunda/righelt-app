---
id: T-091
title: Improve game-card loading state feel
status: To Do
assignee: []
created_date: '2026-04-06 03:41'
updated_date: '2026-04-06 03:41'
labels:
  - feature
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P3.

Improve the loading state for game cards so it feels more polished, intentional, and visually coherent with the rest of the app. This is a focused follow-up on the loading experience of game-card surfaces specifically, even though broader UI-feel work may eventually absorb or supersede it.

Potential scope:
- Refine the loading skeleton or placeholder treatment used for game cards so it better matches the final card layout and feels less generic.
- Improve the perceived smoothness and visual polish of transitions from loading state to loaded card content.
- Revisit motion, placeholder hierarchy, spacing, and information preview so the card-loading state feels more purposeful and branded.
- Ensure the loading state remains readable and calm rather than visually noisy or distracting.
- Coordinate with `T-087` (Holistically refine UI feel, brand, and forward UI principles), which may supersede or absorb this work if the broader UI-feel pass reaches the same surface.
- Add or update regression/guard coverage where concrete game-card loading-state contracts should remain stable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Game-card loading states feel more polished and intentional than the current treatment.
- [ ] #2 The loading treatment better matches the structure and feel of the loaded game-card UI without becoming noisier or less usable.
- [ ] #3 Relevant validation or regression coverage is updated for any concrete loading-state UI contracts that should remain stable.
- [ ] #4 The task is considered compatible with T-087, including the possibility that the broader UI-feel work supersedes or absorbs this refinement.
<!-- AC:END -->
