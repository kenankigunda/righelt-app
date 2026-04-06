---
id: T-027
title: >-
  Ask other participants whether they want to join when launching from
  history/scenario
status: To Do
assignee: []
created_date: '2026-04-04'
updated_date: '2026-04-06 03:33'
labels:
  - feature
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P2.

When a user branches a game from history or launches a new game from a scenario, the other player and any viewers should not be joined into the new game automatically. Instead, they should receive an explicit invite/prompt asking whether they want to join the new game.

The intent is to make the transition to the newly created game opt-in for other participants, rather than silently carrying them over.

Potential scope:
- Identify the current automatic participant carry-over behavior for history branching and scenario launch flows.
- Replace automatic joining with an explicit popup/invite flow for the other player and viewers.
- Ensure the initiator still reaches the new game as expected, while other participants are prompted rather than auto-added.
- Define what happens when participants decline, ignore, or respond later to the join prompt.
- Add regression coverage for both history-branch and scenario-launch entry points so participant invitation behavior stays intentional.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When a game is created by branching from history, the other player and viewers are not automatically joined into the new game.
- [ ] #2 When a game is created by launching from a scenario, the other player and viewers are not automatically joined into the new game.
- [ ] #3 The other player and viewers receive an explicit invite/prompt to join the new game instead of being carried over silently.
- [ ] #4 The initiator still lands in the new game successfully, while non-initiating participants remain opt-in.
- [ ] #5 Relevant regression coverage is updated for both history-branch and scenario-launch participant invitation behavior.
<!-- AC:END -->
