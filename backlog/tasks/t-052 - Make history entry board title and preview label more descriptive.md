---
id: "t-052"
title: "Make history entry board title and preview label more descriptive"
status: "To Do"
assignee: []
created_date: "2026-04-05"
updated_date: "2026-04-05"
labels: ["improvement"]
priority: "low"
dependencies: ["t-001", "t-040"]
---

## Description
Notion priority: P3. Improve the board title and preview copy shown while viewing a history entry so the user gets clearer context about what move they are looking at and what state the board is showing.

Potential scope:
- Replace generic history-mode copy such as "Showing recorded move." with language that identifies the selected move more explicitly.
- Clarify in the board title and/or preview label whether the board is showing the move's end-of-move snapshot, selected action context, or live view.
- Make history-mode messaging resilient across move types such as move, rush, project, push, follow, retreat, and pass.
- Ensure the board header, preview label, and history panel selection wording feel coherent rather than partially redundant.
- Add regression coverage for the history-specific board title/preview contract so future copy or layout changes do not regress clarity.
