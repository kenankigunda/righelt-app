---
id: T-081
title: Investigate residual move lag after sync store implementation
status: To Do
assignee: []
created_date: '2026-04-06 01:51'
labels:
  - bug
dependencies: []
references:
  - >-
    backlog/assets/example-of-move-with-lag-that-cause-browser-slowdown-popup.png
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P0.

After completing the sync store implementation, some moves still have a lag between the click and when the move is optimistically created. That should not be happening if the client is working responsively.

A specific trigger pattern has not yet been identified, so this should be investigated holistically rather than assuming a single narrow cause.

One example is captured in the attached screenshot. In that case, the final follow in the sequence starting from the push on move 43 was very sluggish, to the point that Firefox showed a popup saying: "A script is slowing down your browser". The move did eventually complete and the browser unblocked, but it took far too long.

Investigation prompts to consider include, but are not limited to:
- Are there places where we are doing expensive operations on the critical path that should be avoided, deferred, memoized, or moved off the hot path?
- Should a web worker be introduced or expanded so the UI thread stays maximally unblocked during move creation and related state derivation?
- Are there specific move shapes, sequence states, history conditions, or board states that correlate with the lag?
- Are we blocking optimistic creation on work that can happen after the client-visible response?
- Are there unnecessary re-renders, selector recalculations, or repeated derivations happening during move initiation?
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reproduce or otherwise characterize the residual move-lag issue with enough detail to understand when it occurs, even if the pattern is intermittent.
- [ ] #2 Identify the main contributors to the lag between click and optimistic move creation, including any expensive work on the UI thread or critical path.
- [ ] #3 Evaluate whether architectural changes such as moving work off the main thread are warranted, and document the chosen direction.
- [ ] #4 Implement a fix or set of fixes that makes optimistic move creation feel consistently responsive for the investigated lag cases.
- [ ] #5 Add or update regression coverage and validation for the affected move-initiation path, and document any remaining known risks or unknowns.
<!-- AC:END -->
