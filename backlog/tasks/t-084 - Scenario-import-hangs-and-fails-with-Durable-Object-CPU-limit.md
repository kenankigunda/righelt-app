---
id: T-084
title: Scenario import hangs and fails with Durable Object CPU limit
status: To Do
assignee: []
created_date: '2026-04-06 03:21'
updated_date: '2026-04-06 03:24'
labels:
  - bug
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Notion priority: P0.

Observed behavior: launching a game from a scenario hangs and eventually fails. The hang occurs on `https://righelt.pages.dev/api/shell/scenarios/import`, which eventually returns HTTP 500 instead of completing scenario import responsively.

Observed request:
- URL: `https://righelt.pages.dev/api/shell/scenarios/import`
- Method: `POST`
- Path: `/api/shell/scenarios/import`

Observed server error:
```json
{
  "message": "Durable Object exceeded its CPU time limit and was reset.",
  "exception": {
    "stack": "    at async handleLiveGameRequest (index.js:5512:22)\n    at async handleApiRequest (index.js:5757:24)",
    "name": "Error",
    "message": "Durable Object exceeded its CPU time limit and was reset.",
    "timestamp": 1775445449037
  },
  "$workers": {
    "truncated": false,
    "event": {
      "request": {
        "url": "https://righelt.pages.dev/api/shell/scenarios/import",
        "method": "POST",
        "path": "/api/shell/scenarios/import"
      }
    },
    "outcome": "exception",
    "scriptName": "righelt-api",
    "eventType": "fetch",
    "executionModel": "stateless",
    "scriptVersion": {
      "id": "10a823d9-fada-4eb1-8b9d-fc3cd9d1bd62"
    },
    "requestId": "9e7da2f35b51c427"
  },
  "$metadata": {
    "id": "01KNGCQ6ADNP4DE75YADDQTGAW",
    "requestId": "9e7da2f35b51c427",
    "trigger": "POST /api/shell/scenarios/import",
    "service": "righelt-api",
    "level": "error",
    "error": "Durable Object exceeded its CPU time limit and was reset.",
    "message": "Durable Object exceeded its CPU time limit and was reset.",
    "account": "8e4ab8325d9b60266b6d5c997beffca2",
    "type": "cf-worker",
    "fingerprint": "da96d8deeaf75cec000c5990ddd38bc9",
    "origin": "fetch",
    "errorTemplate": "Durable Object exceeded its CPU time limit and was reset."
  }
}
```

This suggests scenario import needs a performance improvement rather than only an error-handling fix. Investigate holistically, including whether scenario import is doing too much work inside the Durable Object request path, whether expensive computation can be reduced or deferred, and whether the import flow should be restructured to avoid hitting CPU limits on realistic scenarios.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Launching a game from a scenario no longer hangs and fails with a 500 from /api/shell/scenarios/import for the reproduced case.
- [ ] #2 The main contributors to the Durable Object CPU overrun during scenario import are identified and addressed.
- [ ] #3 Scenario import stays within Durable Object CPU limits for the affected scenario-import path, with validation that demonstrates the improvement.
- [ ] #4 Any structural performance changes needed for scenario import are documented and covered by regression validation so this failure mode does not silently return.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Additional reproduction detail:
- I was able to successfully launch the simple scenario `Cannot project into unsupplied area`.
- I hit the failure on the more complex scenario `Push vs. project strategy endgame`.

This suggests the scenario-import performance problem is likely correlated with scenario/game complexity, and in particular may be linked to the number of moves or amount of history/state that import has to process. This likely overlaps with `T-078`, which tracks CPU-timeout/load failures on games with many moves.
<!-- SECTION:NOTES:END -->
