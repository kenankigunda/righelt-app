# Workflow Coverage Map

This inventory tracks which user workflows have:

- a success-path `E2E`
- a recovery/failure-path `E2E`
- integration coverage for important workflow variants

Status meanings:

- `present` = coverage exists in the current repo
- `partial` = some coverage exists but variants or recovery are still incomplete
- `missing` = no intentional coverage yet

| Workflow | Success E2E | Recovery / failure E2E | Integration variants |
| --- | --- | --- | --- |
| Create game and land as `Player 1` | `present` | `present` | `present` |
| Invite recipient enters the game as viewer | `present` | `present` | `present` |
| Direct-link recipient requests player join approval | `present` | `present` | `present` |
| Approver accepts or ignores request | `present` | `present` | `present` |
| Synchronized live updates across participants | `present` | `present` | `present` |
| Move reflected in all active browsers | `present` | `present` | `present` |
| History navigation and return to live | `present` | `present` | `present` |
| Identity and role persistence across reload | `present` | `present` | `present` |
| Reconnect or degraded connectivity recovery | `present` | `present` | `present` |

## Current Notes

- The required Playwright suite now covers representative recovery proofs for reconnect, history/live return, reload persistence, and third-client viewer fallback after seats fill.
- Deeper workflow variants, revert lifecycles, and refresh/missed-update reconciliation remain owned primarily by deterministic shell integration and transport tests.
