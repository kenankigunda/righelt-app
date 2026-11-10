# Validation evidence policy

Keep the full stable PR gate on every PR and main push. CI narrowing remains shadow-only and requires its separate qualification. Current-head protection, explicit authorization, normal deployment and exact served-identity verification remain required.

## Plan before execution

Use the released `plan --candidate /absolute/path --base origin/main` command. Supply `--plan /absolute/plan.json` for feature acceptance, or `--manifest FILE --stage N` to inspect one integrated stage. Planning does not install dependencies, launch tests, fetch GitHub, acquire a run lock or write outputs. It reports selected checks, compatible evidence, missing mappings and reasons. Recheck inputs when executing.

New plans use version 3. Local and integrated execution use the same planner. Every additional check needs a mapped changed contract, an explicit acceptance requirement or a concrete unresolved regression risk. Preserve existing explicit requirements. Do not invent blanket fresh/retained, screenshot, full-suite, browser-matrix or performance gates. Continue independent preparation while CI runs, unless the user explicitly requested waiting. A required failed check remains a failure.

Version 2 manifests retain their original acceptance and review semantics. They are not silently upgraded. An unmapped product change blocks version 3 execution until its acceptance question is recorded. Documentation and instruction changes normally need only current-head CI and any affected tooling contracts.

## Evidence bindings

A version 3 question names `id`, `description`, affected `paths`, `checks` and `evidence`. Evidence binds a check to the contract actually observed:

- `{"check":"PR gate","requirements":["test-infrastructure"]}` binds a requirement in the stable suite catalog. It does not claim a separate feature workflow ran.
- `{"check":"Boundary E2E","files":["e2e/workflows/history-narration.spec.mjs"]}` runs the named original candidate files. Include `"PR gate"` in `checks`; the explicit files are additional acceptance.
- `{"check":"Browser integration","files":["browser-integration/history-narration.spec.mjs"]}` selects the named native files using the candidate browser configuration. Include `"Browser integration"` in `checks`.
- `{"check":"Responsive proof","workflows":["create, move, viewer live update, reload and reconnect"]}` binds the exact reported workflow title. Include `"Responsive proof"` in `checks`.

Use `continuity:["guest","account"]` on the affected question when the change needs existing identities, ownership or persisted history proved across an upgrade. This selects baseline and upgraded continuity checks. Omit unneeded kinds. Checkpoint expiry, original provenance, session deadlines and stopped-state checks remain mandatory. Missing historical continuity is a disclosed gap, never repaired by relabeling new seeds.

Visual evidence is opt-in through `visual:{viewports:["mobile","mid-wide"],checkpoints:["created","reconnected"]}`. It requires a selected producer. Behavioral coverage and visual review are distinct. Inspect meaningful changed originals once, retain their digests and provenance, and do not require image-by-image human sign-off.

## Reuse and stopping

Version 3 stateless checks share an owner-private evidence store in the repository's common Git directory. Compatible inputs, commands, executor, runtime/browser identity, dependencies and relevant environment must match. Uncertain input boundaries use broader fingerprints. The original immutable log and provenance remain attached. New immutable receipts do not expire solely because a day elapsed. Legacy receipts retain their expiry. Stateful responsive checks are never substituted with stateless cache results.

A supplied CI import that cannot verify blocks its requested credit with a specific diagnostic. Repair that import or explicitly choose to execute the missing check. Do not silently launch another entire gate because an evidence reader failed. An older head cannot satisfy current-head branch protection even if some local evidence is compatible.

A stateless check owns its evidence key until completion and source-stability verification. Concurrent identical checks wait for that result rather than duplicating work. Before a rerun, archive its prior active index so a failure, interruption or exception cannot revive an older pass. Preserve owned lock evidence after an interruption. Recovery requires the saved PID/start identity to be absent or definitively reused and any linked supervised run to have verified cleanup. Archive that exact owner record, remove only its positively abandoned key lock, and rerun the affected check. Never remove a live or uncertain lock.

After a repair, rerun the failing case and affected subsystem, then only invalidated final checks. Reuse unchanged successful proof and bounded independent review. Stop once the recorded acceptance questions are answered. More checks, screenshots or stress repetitions need an unresolved correctness reason.

## Release and adoption

Develop tooling in an isolated candidate and use the pinned release for ongoing delivery. Test and independently review tooling before protected merge. Install the merged release and update the three personal validation/shipping skills with backups through the existing installer. Render parent templates from that release without disturbing unrelated checkouts. Do not replace a harness or move main during an acceptance run pinned to those inputs. Verify the installed planner, reuse and invalidation behavior before telling delivery to adopt it. Publication, email and paused schedules remain unchanged.

## Work ahead during deployment verification

Once a protected merge is confirmed, immediately refresh the next authorized feature branch against that actual merged main. Continue implementation, focused checks, independent review, ordinary push and exact-head PR CI while the preceding main CI, automatic deployment and served-identity checks run. Deployment waiting is a constraint on the next merge, not a stop instruction for development.

Keep separate owners/actions for verification of the latest merge and preparation of the next change. One lead may use bounded waits and make progress between them. Report both tracks and the exact remaining merge condition. Source preparation and remote CI can proceed concurrently; local heavy work still uses the shared queue. Do not move main under an acceptance run pinned to it.

If deployment verification fails, retain its failure and block the next merge. Continue safe independent preparation while investigating the failure. Revalidate only dependent inputs after a repair. Never substitute another revision's successful deployment for the required served identity. Authorization and explicit user wait commands remain binding.
