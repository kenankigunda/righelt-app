# Computer tab recovery

The Players card reports the local computer runner's authority and health. Its computer row expands with keyboard or pointer input. Resume here is available immediately unless this tab is healthy and active. Waiting for a human turn counts as active. Owner permissions, finished games, unsupported servers and in-flight recovery have explicit disabled explanations.

Automatic control acquisition respects the existing fifteen-second lease. Its failures are recorded and retried with the shared capped delays. Unsettled durable commands remain the transport's responsibility. A renewal error refreshes authority before discarding a calculation.

The unsolicited recovery notice waits thirty seconds without computation progress or an advancing position. Visibility, navigation and account changes reset that wait. Healthy work, confirmation, manual play, pause, human turns and completed games suppress it. Explicit card recovery has no delay.

Resume here requires the advertised resume-here-v1 capability and shared receipts. It reconciles previous delivery, refreshes authority, then issues one durable owner-only command. The server advances the generation, transfers the lease and clears play overrides while preserving the model and seats. Repeated delivery retains the same request identity.

## Coordination

- Recovery chat owns PR158 transport receipts, retry ownership, capability advertisement integration, and outer API CPU optimization. Integrated committed prerequisites e0f016aeb7ca4dcdcf8ba45a1628ebe0d20e6366 and e81f0dcafa766aeab1b9e8e1116773634af6a9be. Receipt repair8daad3f and server CPU stream407f9e25e329977399c702c27273bdc710aa44a9 are also integrated. Later recovery repairs must be integrated before release.
- App improvements owns PR156 and Players prerequisite 5e16db4 (base c21a69ea2593f8fb06e341a5b03a97ae59c49fcd), geometry, presentation and the shared release ledger. The earlier semantic-only computer badge decision is superseded in Players by actual tab activity. Home's computer badge remains an identity label.
- This feature owns session activity, automatic acquisition, deliberate resume semantics, Players wiring and associated tests.
- Training keeps its existing holds. Test windows require explicit resource readiness. No model or storage-writer activation is included.
- Release order remains controlled by App improvements. Tooling157 and engine150 are merged and released (actual engine squash b7661ce). The coordinator moved independent recovery158 ahead of tooling161 and board154. This feature follows its remaining UX prerequisites against actual merged heads. One deployment owner at a time.
- Coherent recovery source bba259a05957ba70e6b045d8643714a2a4c1e78b is integrated, including its post-renewal owner-scope fence and three account/game/transport switch regressions. Conflicts preserved both test tails, action-contract and history capability headers, shared receipt completion, and this feature's activity/Resume here behavior. The actual150 merge46cf9de was tree-identical to the already integrated implementation.
- Canonical overdue-save source387b0ea is frozen here while App improvements ports it into the earliest UI prerequisite. Its shared helper preserves quiet initial saves and actionable recovery at fifteen seconds.
- User authorized this feature's merge and deployment on October25. This does not activate model/storage flags, resume schedules, or publish evidence.

## Evidence and remaining release gates

The full web suite passed1052 checks after the canonical overdue-save fix387b0ea. After the coherent158 handoff, session/transport/recovery integration passed133 checks. Server stream/control/self-play previously passed31 checks. Component evidence passed18 checks across Chromium, Firefox and WebKit at320/390/1440 widths after the narrow Computer badge wrapping repair. Raw artifacts remain in test-results/computer-recovery.

Actual Chromium stack proof covers reopening after tab closure, manual-play restoration with a lost control response, competing tabs, and abrupt owned browser termination. The observed Debugger suspension probe passed at4c69b39: authority remained unchanged until lease expiry during suspension, then acknowledged renewal followed resume without an advancing position. The earlier Page lifecycle freeze probe did not emit freeze/resume events and is retained as failed test evidence. Native OS background/freeze behavior remains unverified.

Independent review found no remaining actionable findings in the reviewed feature changes or observed suspension test. Real-stack Firefox/WebKit coverage, updated recovery fixture/timing browser proof, final combined committed-head proof, exact-head CI, remaining prerequisite merges and coordinated deployment verification remain required. PR160 is draft and not merge-ready. Local tests do not establish release readiness. Evidence publication remains paused.

The approved production investigation found outer API CPU failures on this game's control and read requests. Recovery158 owns the streaming response repair and deployment. After its verified production source SHA and rollout time arrive, this feature owns a bounded read-only provider-log check for the original game. No original-game mutations are authorized by that check.

Server-side computer execution is tracked as backlog T-131, To Do, improvement, First public release m-2, pushed at backlog commit8519342.
