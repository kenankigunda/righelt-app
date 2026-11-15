# Continuous delivery programs

Use this standard for an approved, ordered batch of Righelt changes. It is the current starting point. Feature-specific requirements remain in their tasks and handoffs.

## Sources of truth

Keep one purpose per artifact:

- **Task:** current execution status and links to its approved contract.
- **Handoff or contract:** approved requirements and acceptance criteria.
- **Decision register:** approval source, selected references, one owner and canonical PR, merge, deployed identity, and acceptance receipt. Use `../righelt-backlog/backlog/docs/ux-decisions/decision-delivery-register.json`; its sibling README defines the record format.
- **Local continuation checkpoint:** an ignored JSON file under the owning worktree's `test-results/<program>-state/active.json`, containing only the current accepted predecessor, active head and gate, next executable action, owned resources, and safety limits.
- **Validation evidence:** commands, results, browser/runtime details, failures, and reviewed artifacts.

Do not copy the whole queue into the checkpoint or maintain another owner registry. The coordinator is the only canonical register writer.

## Intake and ownership

For each new report or study:

1. Record it as exploratory and search for an existing owner.
2. Do not queue unselected concepts.
3. Once approved, record the exact approval, selected reference, task or handoff, priority, and one owner.
4. Group work by one product or lifecycle contract, not by file count or the order feedback arrived.
5. Use one canonical branch and PR per coherent outcome. Preserve older branches, worktrees, evidence, and failed attempts.

Adjacent feedback belongs in an active PR only when it is another instance of that PR's explicit contract and does not expand its risk boundary. Otherwise, queue it separately.

## Execution loop

Re-anchor before work: refresh remote `main`, confirm the exact deployed web and API identities, inspect the released validation plan, check owned resources, and confirm required browser access.

Then keep this loop active:

1. Advance the critical-path PR.
2. While it waits on review, CI, merge, or deployment, prepare and test the next independent group.
3. Refresh a prepared successor once onto the actual deployed squash before its merge.
4. Only the next dependent merge waits for predecessor deployment acceptance.
5. If a lane is blocked, diagnose it and immediately use free capacity on independent product work, evidence, review, or successor preparation.

Real progress is a new implementation, diagnosis, deterministic test, review result, CI or deployment result, evidence artifact, or acceptance step. A running label, old timestamp, polling loop, or status message is not progress.

Use the fewest lanes that create useful concurrency. Give every lane one owner, bounded scope, expected output, and stop condition. Serialize heavy and browser work through the shared resource queue. Never stop or reuse another task's resources.

## Per-PR release gate

For every product PR:

1. Inspect the released version 3 validation plan for the exact candidate.
2. Run `pnpm check:test-durability` before slower checks.
3. Add independent expected-answer proof for changed behavior and a failing-before test for a reproduced regression.
4. Run focused unit, integration, and native-browser proof only where the changed contract requires it.
5. Obtain bounded independent review of the coherent diff and affected evidence.
6. Run the full exact-head `PR validation` over `pr-gate`. Retired `Full validation` and advisory nightly results do not block delivery.
7. Use the authorized protected merge flow.
8. Require green main CI and normal deployment. Record exact served web, loaded-client, and API identities.
9. Run narrow production acceptance with fresh test-owned state when the changed boundary needs it.
10. Atomically update the task, register, and pushed tracking receipt.

Reuse compatible evidence. After a repair, rerun the failing case, affected subsystem, and invalidated acceptance questions. Do not rerun a full browser matrix without a concrete unresolved risk.

Protected observers are fail-closed evidence. When source movement invalidates one, confirm that its observed boundary is still correct, refresh only exact bindings, independently verify unchanged operations, privacy limits, and guards, then rerun the affected observer and stable exact-head gate. Never weaken or bypass it to make CI green.

Keep these decisions separate: ready for review, validated and authorized for merge, deployed, and accepted. None implies the next.

## Tracking transitions

Update tracking at these boundaries:

- **Approved and queued:** approval, selected references, owner, task, handoff, and priority.
- **PR opened or repaired head:** canonical PR, branch, exact head, predecessor, review, and current evidence.
- **Deployed and accepted:** merge, main CI, deployment, served identities, scoped acceptance, task completion, and pushed tracking commit.

Run `pnpm check:decision-register` at PR opening, before merge, and during final reconciliation. A study, local commit, green CI run, merge, or deployment is not completion by itself.

## Browser, production, and network boundaries

Record browser/profile, viewport, zoom, and task-owned tab IDs. Native Safari is separate from Playwright WebKit. Do not drive a browser the user has reserved for their own use.

Use production only through supported lifecycle actions and fresh, labeled test-owned records. Do not inject faults into production, mutate retained or restricted games, rewrite production records, or infer schema, activation, account, model, publication, or rollout authority from merge approval.

For multi-user proof, compare authority-neutral state across participants first, then check each viewer's labels and controls separately.

Treat compact cards and summaries as hints, not terminal evidence: verify important result or state claims through the stricter authorized detail read before accepting them. Never classify application, authorization, or data-integrity failures as transient network failures.

For network defects, preserve the exact loaded build, browser and topology, episode/socket generations, owner and blocker, request results, and resolution. Prove the intended fault was reached. Reduce the defect to a deterministic failing-before test, repair the owning fencing, settlement, lifecycle, or authority contract, and avoid scenario-specific timers or blanket retries. HTTP reads may refresh state but never grant gameplay authority.

Every socket, recovery episode, poll, reminder, lease, and retry owner must retire when its route, session, or generation ends. A stale owner must not block, resolve, fail, notify, or transfer authority for a newer one.

## Batch completion

After all planned PRs deploy, run one cumulative product campaign over the changed and interacting boundaries. Reuse unaffected historical proof. Fix approved-journey defects and security, authority, data-integrity, or core-play blockers. Record unrelated findings separately.

Then run the dedicated cross-browser network-hardening campaign. Continue after each repair until planned scenarios pass, transient interruptions converge without false failure, genuine outages fail clearly and recover through Retry, durable commands remain correct, and no unexplained incident signature remains.

Completion requires deployed and accepted tasks, both campaigns complete, register reconciliation pushed, production data preserved, owned resources cleaned, and any wake schedule paused.

## Wake and recovery

A scheduled heartbeat is opt-in and only a quiet wake signal for the coordinator. Reuse the one matching automation; never create a duplicate. A paused schedule stays paused until the user explicitly resumes it. On wake:

1. Read the checkpoint and register.
2. Verify concrete progress from heads, runs, deployments, and owned resources.
3. Stay quiet if meaningful work is advancing.
4. If progress stopped, preserve work, identify the exact blocker, take the next safe authorized action, and redirect free capacity to independent work.

The heartbeat never becomes a second worker, register writer, or campaign owner. Ask the user only for new authority or a material product decision.

## Skill release boundary

Repository skill changes become canonical only after review, exact-head validation, merge, and deployed documentation identity. Installed skills remain pinned until an explicit installation or refresh step; never silently run an unmerged candidate skill as released tooling.
