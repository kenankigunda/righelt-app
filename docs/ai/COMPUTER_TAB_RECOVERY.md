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
- Release order remains controlled by App improvements: tooling157, engine150, board154, remaining UX prerequisites, then recovery and this feature against actual merged heads. One deployment owner at a time.
- User authorized this feature's merge and deployment on October25. This does not activate model/storage flags, resume schedules, or publish evidence.

## Evidence and remaining release gates

The combined web suite passed1047 checks at90d0472. Transport/sender/session integration passed142 checks after receipt repair, and server stream/control/self-play passed31 checks. Scoped history conflict repair passed28 checks. The component matrix passed18 checks across Chromium, Firefox and WebKit at320/390/1440 widths. Visual inspection identified a narrow name truncation issue, repaired by wrapping the Computer badge. That responsive repair still requires its bounded rerun. Raw artifacts remain in test-results/computer-recovery.

Independent review found an unsupported-server recovery notice action, now suppressed by shared capability eligibility. Bounded re-review reported no remaining actionable findings in that fix or session hardening.

The first real-stack attempt failed at the accepted-control reconnect latch in prerequisite PR158; its committed repair is now integrated. The run was stopped at that failure with artifacts retained and cleanup verified. Real-stack rerun, final combined committed-head proof, exact-head CI, prerequisite merges and coordinated deployment verification remain required. Local tests do not establish release readiness. Evidence publication remains paused.

Server-side computer execution is tracked as backlog T-131, To Do, improvement, First public release m-2, pushed at backlog commit8519342.
