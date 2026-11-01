# Game loading and shared search audit

## Reproduction

Production game `game-8f591fc5b97c9b7d6afb7594c35851096461` stalled on its loading skeleton. Health, bootstrap, another game's full response, and this game's lightweight list preview responded normally. Its full GET exceeded a 20-second diagnostic timeout. Provider execution logs were unavailable, so a specific Cloudflare execution-limit failure remains unconfirmed.

The recovered rules position and ordered actions are retained in `packages/game-engine/test/fixtures/game-loading-{rush,actions}.json`. The action baseline came from the unmodified generated engine at `0ace3cb4`, whose legal and continuation files matched the deployment during diagnosis. No player identities, credentials, or game history are retained in these artifacts.

Cold local enumeration before optimization took about 3.2 seconds and 240,262 continuation expansions. One rejected rush, U2-2 from (4,5) to (5,6), used 240,174 expansions. After pruning, complete enumeration returned the same ordered 34 actions with 90 expansions in 14.9 milliseconds. Timings are diagnostic measurements, not portable latency guarantees. The regression enforces fewer than 1,000 expansions and exact baseline actions.

## Findings and changes

| Path | Finding | Treatment |
| --- | --- | --- |
| Rush completion | Ignoring all enemy command edges made permanently trapped destinations appear potentially rescuable. | Retain only barriers that no remaining friendly actor can possibly interrupt. Reachability remains an overestimate, so only impossibility is inferred. |
| Push completion and stabilization | Successor state construction was already lazy on main, and monotonic actor flags bound chains. | Preserve that implementation and exact candidate ordering. Run adjacent push, retreat, stabilization, and replay tests. |
| Recursive memoization | Visiting/failure entries are local to a search; the existing decision cache stores completed outer calls with full rule inputs and bounded storage. | Preserve scope and keys. Do not introduce shared path-dependent negative results or an unbounded cross-game cache. |
| Supply hints | Breadth-first guidance retains path history to preserve irredundant-route semantics. The frontier lacked cooperative expansion accounting. | Reuse sound rush pruning and account for both visited nodes and constructed successors. Budget interruption produces no partial hint result. |
| API full views and legal/preview work | Ordinary synchronous rule calls lacked the computer player's operation budget. | Apply the shared 16,384-expansion ceiling. Exhaustion throws `rules_budget_exceeded`; room responses report retryable 503 without claiming illegality. |
| Browser rules | Cancellation terminated workers, but general projection/preview workers lacked their own hard deadline. | Use the existing request deadline, terminate expired workers, release queued work, and ignore late results. Never fall back to synchronous browser execution. |
| Computer selection | Existing engine guards and a bounded opt-in decision cache already protect model-guided operations. | Preserve model, policy, action encoding, node limits, and strategy. Validate affected computer contracts rather than tune playing strength. |
| Initial game loading | Complete view construction coupled saved-board visibility to legal enumeration. | Add a separately typed position-only read. Display it with the existing perimeter spinner while complete state loads. |

## Position-only safety contract

`GET /api/shell/games/:id/position` reads durable state without dispatching a room operation or mutating a game. It uses existing authorization, account-name enrichment, and sanitization. The shared `position-v1` discriminator and `positionOnly` marker distinguish presentation from synchronization.

The browser stores this view separately from authoritative games, event cursors, command receipts, and optimistic projection. The complete-snapshot validator rejects position-only views. Late position replies cannot replace a complete response or survive account retirement. Older full responses cannot replace a newer displayed position.

Saved board and history remain readable. State-changing controls remain blocked until complete state is ready. Failure retains the board, stops its spinner, and offers manual retry without replaying a mutation. Optional hint failure preserves legal play and offers a separate hint retry.

## Validation and release

Focused engine, transport, API projection, worker deadline, and hint tests cover these contracts. The small-board pruning oracle explores completions independently of the new impossibility proof. Exact final checks, browser results, screenshots, and unresolved gates belong to the PR validation evidence rather than this static audit.

Coordinate shared engine changes with automatic game ending and loading/notice changes with Feedback push 10/29. No GET migration writes or terminal-rule changes belong to this fix. Evidence publication and paused schedules remain paused. Merge and deployment coordination belongs to the designated Feedback chat after technical validation and review.
