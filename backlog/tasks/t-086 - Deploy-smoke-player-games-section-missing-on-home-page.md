---
id: T-086
title: Deploy smoke player games section missing on home page
status: To Do
assignee: []
created_date: '2026-04-06 03:25'
updated_date: '2026-04-06 03:29'
labels:
  - bug
dependencies: []
references:
  - backlog/assets/home-page-debug-mode-no-deploy-smoke-games.png
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P2.

Observed behavior: in production, even in debug mode, the home page does not show the `Deploy smoke player` section. Example screenshot: `backlog/assets/home-page-debug-mode-no-deploy-smoke-games.png`.

Current expected behavior per the codebase:
- The home page defines a dedicated `smoke` section labeled `Deploy smoke player`.
- That section is only visible in debug mode; non-debug mode should show only `My games` and `Other games`.
- Smoke games should be isolated into the dedicated `smoke` section and excluded from the general `Other games` section rather than being mixed in there.

This appears to be a bug in the home-page grouping, visibility, or rendering logic for deploy smoke games.

Potential scope:
- Verify whether deploy smoke player games are being filtered out entirely, grouped into the wrong section, or failing a debug-mode visibility condition.
- Check whether the regression is in server grouping, client rendering, labeling, route/debug-state wiring, or a data-shape mismatch.
- Restore the dedicated debug-only home-page section for deploy smoke player games and confirm it behaves correctly alongside the existing `Other games` section.
- Add regression coverage so this section does not disappear again silently.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The home page shows a dedicated section for deploy smoke player games when such games exist.
- [ ] #2 The grouping/rendering logic for the deploy smoke player section is covered by regression validation so the section does not disappear again silently.
- [ ] #3 Deploy smoke player games are separated from the general `Other games` section rather than being omitted or mixed in incorrectly.
<!-- AC:END -->
