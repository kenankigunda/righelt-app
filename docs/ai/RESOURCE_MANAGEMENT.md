# Task resources

Use supervised launches for temporary previews, builds, browser tests and watchers. This prevents nested workers surviving task completion and defers heavy jobs when macOS reports memory pressure.

## Commands

- `pnpm resources:run --kind heavy -- COMMAND ARGS`: run a build or test, with pressure checks and whole-process-group cleanup.
- `pnpm resources:run --kind preview -- COMMAND ARGS`: run a disposable preview. Sustained pressure releases it.
- `pnpm resources:run --kind idle -- COMMAND ARGS`: run an idle disposable service.
- `--keep` preserves preview/idle services from pressure-triggered cleanup when the user explicitly requested them. Exit, cancellation and launcher-death cleanup still apply.
- `--timeout-ms N` adds an explicit runtime limit. Existing test timeout budgets stay unchanged.
- `pnpm resources:status`: inspect active runs and incomplete cleanup for this canonical checkout. Add `--all` to inspect completed receipts.
- `pnpm resources:cleanup --run RUN_ID`: stop one identified run. Never select another task's run merely because its checkout matches.

Development scripts and browser-test scripts use the supervisor automatically. Validation check commands use the installed harness's supervisor. Validation commands already owned by a supervisor skip a redundant outer wrapper. Explicit preview launchers retain their own guardian because browser runners may create separate process groups. Each guardian watches its launching process and cleans up if it exits. Direct tool commands outside these entrypoints must use `resources:run`.

## Ownership and cleanup

Every run records its checkout, run ID, supervisor identity and observed group-member identities. Records live under `~/.local/state/righelt/resources`, shared across worktrees, with private permissions. Completed receipts retain the latest pressure/swap sample and cleanup result, capped at 100 receipts and seven days. Active runs and incomplete cleanup are never pruned. `RIGHELT_RESOURCE_REGISTRY` overrides that directory for isolated tests.

On macOS, run supervised commands with scoped outside-sandbox access when process-table inspection is denied. Ownership inspection failure before launch stops the command rather than launching unsupervised work.

Normal completion, failure, timeout, cancellation and loss of the launching process terminate the owned process group. Cleanup sends SIGTERM, waits five seconds, then sends SIGKILL to remaining owned group members. It verifies that no live owned group members remain. Cleanup failure is an error, never success. A child deliberately escaping the group is outside this guarantee and must not be launched detached inside supervised commands.

An abandoned record authorizes signals only to matching saved process identities. PID reuse or a process-name match never establishes ownership. Do not use broad process-name kills, kill unrelated servers, or delete worktrees as resource cleanup. A stable process-group leader waits for verified ownership before starting the command. If its guardian is killed, the IPC disconnect triggers group cleanup. Inspect any remaining registry record and explicitly clean that run before retrying.

## Pressure policy

On macOS, read `kern.memorystatus_vm_pressure_level` and `vm.swapusage` before launch and every 15 seconds. These are read-only probes. Never run memory-pressure simulation. Warning or critical pressure defers heavy launches. Four consecutive normal samples reopen launch eligibility after an observed pressure event.

Warning pressure lasting 60 seconds releases disposable preview/idle runs. Critical pressure lasting 60 seconds also cancels the guardian's active heavy job, returning exit code 75. This is incomplete, retryable work, never passing validation. Preserve failure evidence, wait for recovery, and explicitly retry. Do not silently restart jobs in a loop. Swap growth is diagnostic and does not itself trigger cancellation. Pressure transitions are logged once per transition. Missing/denied probes produce an unavailable notice and do not disable process cleanup. Initial Windows support launches the command directly and verifies only direct-child cleanup. Its resource registry status/cleanup commands require Unix process-table support. Other non-macOS platforms have process-group cleanup without a pressure gate.

## Agent checkpoints and UI

At startup, before a new heavy phase, and at completion/handoff, inspect this task's resource records. Stop services the task no longer needs. At completion, failure or cancellation, clean up temporary runs and close task-created browser sessions, previews and panels through supported tools. Maintain the exact tab/session identifiers in the task notes. Close disposable task-owned previews when sustained pressure is reported. Preserve unrelated tabs and user-requested persistent previews.

If the available tools cannot close a panel or tab, report its identifier and the remaining manual cleanup. Never claim closure based only on shutting down its server. Do not quit/relaunch Codex or archive chats as a memory remedy. If pressure persists after owned cleanup, report the condition and defer additional heavy work.

## Release

The shared policy values live in `scripts/resources/policy.mjs`. Change them with regression tests. These are conservative trial defaults, not official Codex limits or proof of a particular application's memory leak.

Harness changes become active only after merging and updating the pinned validation installation through `scripts/install-validation-tools.mjs`. Preserve the previous harness revision in evidence. Run `pnpm setup:workspace` from the released canonical checkout afterward. Publishing and schedules remain paused unless explicitly resumed.
