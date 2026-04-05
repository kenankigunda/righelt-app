---
id: "t-055"
title: "Explore SVG-based piece rendering for more precise cross-state styling"
status: "To Do"
assignee: []
created_date: "2026-04-05"
updated_date: "2026-04-05"
labels: ["feature"]
priority: "low"
dependencies: ["t-001", "t-051", "t-054"]
---

## Description
Notion priority: P3. Explore whether piece rendering should move toward SVG-based visuals so we can achieve more precise, consistent styling across all piece states without relying on increasingly complex CSS approximations.

Potential scope:
- Audit the current DOM/CSS-based piece styling across normal, commanded, uncommanded, preview, created, pending-destruction, and history-destruction states.
- Identify where CSS-only rendering is becoming too imprecise or fragile, especially for split, bisected, or multi-layer piece treatments.
- Prototype an SVG-based piece-rendering approach that can preserve current semantics while improving geometric precision.
- Compare CSS versus SVG for maintainability, theming, testability, performance, and implementation complexity in this board UI.
- Define a migration strategy if SVG proves worthwhile, including how to support shared styling language across live, preview, and history states.
