---
id: T-080
title: Board-wide move vs supply/command toggle across pieces
status: To Do
assignee: []
created_date: '2026-04-06 01:43'
labels:
  - feature
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P2.

Change the move vs. supply/command toggle so it is shared across the board instead of tracked per piece. The board should retain the current mode as the user changes which piece is selected, including when switching between current-player and opponent pieces.

Desired interaction:
- First click on a piece shows that piece's information in the board's current mode.
- Second click on the same piece toggles the board's mode.
- Clicking a different piece shows that piece's information in the now-current board mode.
- In moves mode, clicking an opponent piece should highlight it and show guidance like: "Opponent piece at (x,y). Click again to see supply/command lines."
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The board maintains a single current mode shared across all piece selections rather than storing move vs supply/command state per piece.
- [ ] #2 A first click on any piece shows that piece's information in the board's current mode.
- [ ] #3 A second click on the same piece toggles the board mode and updates the selected piece's display accordingly.
- [ ] #4 After toggling on one piece, clicking a different piece shows that different piece's information in the same current board mode.
- [ ] #5 The shared mode behavior is consistent for both current-player and opponent pieces.
- [ ] #6 In moves mode, clicking an opponent piece once highlights it and shows a guidance message explaining that a second click will show supply/command lines.
<!-- AC:END -->
