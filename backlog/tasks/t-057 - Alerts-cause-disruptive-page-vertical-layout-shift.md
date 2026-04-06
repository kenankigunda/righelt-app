---
id: T-057
title: Alerts cause disruptive page vertical layout shift
status: To Do
assignee: []
created_date: '2026-04-05'
updated_date: '2026-04-06 02:14'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P1. Alert surfaces currently change vertical positioning in a way that causes disruptive page shift, making the shell feel unstable and interrupting reading or interaction flow.

Potential scope:
- Identify which alert surfaces or notification states are inserting or resizing layout space in the main page flow.
- Define the intended layout-stability behavior for alerts, including whether they should reserve space, overlay existing content, or animate in without shifting key panels.
- Reduce or eliminate disruptive cumulative layout shift when alerts appear, update, or dismiss.
- Verify the solution works across game, home, and history-related shell states, including narrow layouts where vertical space is tighter.
- Add regression coverage for alert rendering so future notification changes do not reintroduce disruptive vertical movement.
<!-- SECTION:DESCRIPTION:END -->
