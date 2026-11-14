# Continuous delivery dos and don'ts

Use these rules for long, ordered delivery programs. They capture what improved speed and quality during the marble refresh and its follow-ups.

## Do

- Re-anchor before execution. Confirm remote `main`, deployed web and API identities, clean task worktrees, the released validation revision, owned resources, and required browser access.
- Keep one active coordinator. Use at most two bounded implementation lanes and one rotating reviewer. Give every lane one owner, a stop condition, and a concrete output.
- Keep PRs coherent and small. Group changes by one product contract, not by file count. Refresh each successor once against the actual deployed predecessor.
- Work ahead while gates run. CI or deployment verification blocks only the next dependent merge. Continue independent implementation, review, tests, evidence, and successor preparation.
- Track four transitions only: Exploratory, Approved and queued, Canonical PR, Deployed and accepted. Completion requires approval, PR, merge, served identity, acceptance evidence, and pushed tracking evidence.
- Run durability first. Add failing-before proof for real regressions, run the affected subsystem, then run exact-head `PR validation`. Reuse compatible evidence and rerun only invalidated boundaries.
- Verify the deployed artifact. Record exact web, loaded-client, and API identities before production acceptance.
- Treat browser access as a prerequisite. Record the browser, profile or session, viewport and zoom, and task-owned tab IDs. Native Safari is separate from Playwright WebKit.
- Diagnose network defects from exact evidence. Retain the loaded build, browser and topology, episode and socket generations, current owner and blocker, request result, and resolution. Reduce the defect to deterministic failing-before proof before changing recovery ownership.
- Keep the scheduler simple. A heartbeat wakes the coordinator. The coordinator checks for real progress and acts only when there is a gap.

## Don't

- Do not turn every cosmetic PR into a full release campaign or rerun a Cartesian browser matrix without a concrete unresolved risk.
- Do not wait on retired `Full validation` or advisory nightly checks. The exact `pr-gate` `PR validation` aggregate remains required.
- Do not treat a study, local commit, CI pass, merge, or deployment as completion by itself.
- Do not let a permission, CI, deployment, browser, or account gate stop independent work that does not depend on it.
- Do not let a heartbeat implement, coordinate in parallel with an active lead, or report polling as progress.
- Do not use Playwright WebKit as native Safari evidence.
- Do not inject controlled faults into production or mutate retained production games for validation.
- Do not create duplicate owners, canonical PRs, workflow engines, or tasks for unselected study concepts.
- Do not hide ownership defects with scenario-specific retries, longer timers, or broad test retries.
- Do not renew protected observer hashes mechanically. Confirm that the observed contract and source boundary are still correct first.

## Real progress and blockers

Real progress produces a recent implementation, diagnosis, deterministic test, review finding, CI or deployment result, evidence artifact, or completed acceptance step. A running label, polling loop, or repeated status message is not progress.

Before reporting a blocker, inspect primary evidence and try the safe remedies already in scope. Retry transient or permission-limited work through the approved path, reproduce the smallest failure, repair narrow code or test defects, and redirect free capacity to independent work. Ask for user input only when the next step needs new authority or a material product decision.

