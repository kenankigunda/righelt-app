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
| Create game and land as `Player 1` | `present` | `missing` | `present` |
| Invite recipient enters the game as viewer | `present` | `missing` | `present` |
| Direct-link recipient requests player join approval | `present` | `present` | `present` |
| Approver accepts or ignores request | `present` | `present` | `present` |
| Synchronized live updates across participants | `present` | `missing` | `present` |
| Move reflected in all active browsers | `present` | `missing` | `present` |
| History navigation and return to live | `present` | `missing` | `present` |
| Identity and role persistence across reload | `present` | `missing` | `present` |
| Reconnect or degraded connectivity recovery | `missing` | `missing` | `partial` |

## Current Notes

- The first Playwright rollout covers the highest-risk browser workflows for creation, joining, approval handling, live updates, history, and reload persistence.
- Connectivity degradation and reconnect recovery are still primarily covered below the browser layer and should be the next E2E expansion target.
