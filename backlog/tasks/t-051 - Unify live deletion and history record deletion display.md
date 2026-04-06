---
id: "t-051"
title: "Unify live deletion and history record deletion display"
status: "To Do"
assignee: []
created_date: "2026-04-05"
updated_date: "2026-04-05"
labels: ["feature"]
priority: "low"
dependencies: ["t-001", "t-043", "t-044"]
---

## Description
Notion priority: P3. Align the visual language for live deletion feedback and history-view deletion records so the same event reads as one coherent concept across both surfaces.

Potential scope:
- Reconcile the live removal animation, transient deletion indicator, and history destruction marker so they share the same core shape/motion/color treatment where appropriate.
- Define which parts of the deletion treatment are persistent versus transient, and keep those differences intentional rather than incidental.
- Reduce visual drift between "piece will be destroyed", "piece was just destroyed live", and "piece was destroyed in this history record".
- Add cross-surface UX acceptance criteria and regression coverage so future deletion-style tweaks stay consistent.
