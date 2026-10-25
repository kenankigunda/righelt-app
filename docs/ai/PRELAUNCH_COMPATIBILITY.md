# Prelaunch compatibility and reset policy

Disposable development data should not force the product to carry retired formats indefinitely. Before launch, prefer an explicitly scoped reset when it safely removes that burden. Preserve valuable accounts, trained models and evidence. Revisit this policy when real customer data must survive upgrades.

A reset is a separate operation. Code, merge and deployment authorization do not authorize hosted deletion.

## Removed interpretation paths

| Area | Change | Why it can be removed | Required proof |
| --- | --- | --- | --- |
| Persisted projection reads | Remove SQL fallback that omits `ownership_mode` | Migration 0012 introduced ownership. Current storage migrations and account boundaries require it. A database lacking that column is an incomplete deployment, not a supported guest schema | One current-schema query for guest/account loads. Missing-column and ordinary database failures propagate without a fallback |
| Socket-first loading | Remove alternate GET after reconciliation returns 404/405 | Every supported server has the durable reconciliation route. Switching to an obsolete server read conceals a missing route and cannot establish command outcomes | Missing endpoints fail without alternate reads. Existing socket-first recovery, durable journal and current-server reads still pass |
| Browser persistence | Remove unused `righelt.live_transport.state.v1` reader/writer exports | No production or test caller consumes them. Current online command persistence uses the IndexedDB journal | Whole web module tests and import checks pass. Existing stored values, guest identity and tutorial preferences are not deleted |

These removals require no hosted data reset. They remove unsupported code paths, not supported stored game records.

## Audited dependencies retained

| Area | Reason to retain | Removal condition |
| --- | --- | --- |
| Guest/account ownership and `legacy_guest` discriminator | Guest play remains supported. Account activation makes retained guest games read-only. This protects account-owned data when account enforcement changes | A separately designed product/authority change with guest/account isolation proof |
| Command receipts and legacy tombstones, including archived evidence | They prevent accepted or historically evidenced commands from being replayed as new writes after retries, reload, undo, archive or reset | Explicit coverage of every live/archive store and browser journal, with fenced old clients and proved non-resurrection |
| Storage codecs, checksums, format validation, archive publication and restore permits | They enforce current integrity and atomicity. Both compact and uncompressed representations are current operational modes | A separately reviewed storage change with retained-state and interruption proof |
| Projection normalization, missing destruction metadata and stable history IDs | Current tests and retained games rely on these shapes. Broad deletion without inspecting retained data could change history or roles | An explicit scoped reset or proof that every retained current game has the canonical fields |
| `playgroundMode` aliases | Current clients write `selfPlayMode`, but raw retained prelaunch projections and migration fixtures can still use the old name. Silent removal could change roles or self-play labels | Inspect retained data, then reset affected disposable games or reject retired shapes explicitly. Remove aliases from create/import/projection paths together |
| Pass continuation records | The action-contract change retires continuation Pass generation and application. Historical records still exist as evidence | Use current-contract fixtures for replay. A separately approved game-data reset may retire obsolete records. Never silently translate submissions |
| Model IDs, profile versions, `absolute-v1` config and historical `passIndex` field | Checkpoint, frozen-plan, manifest and export hashes bind these bytes. The semantic action change can reuse the existing policy slot without changing trained weights | A future explicit encoding/training version with regenerated artifacts and parity proof. Avoid expensive retraining merely to rename metadata |
| Training readers, policy-mask defaults and inherited health/provenance records | They support valuable trained checkpoints and reproducible evidence, rather than disposable app data | Inventory retained runs and prove their replacement before removing readers |
| Process identity, bounded computation and partial-legality safeguards | They protect current correctness and task resources | A behavior-preserving replacement with cancellation, ownership and incomplete-work proof |

Do not turn this list into permission to preserve every fallback. Name its actual consumer, data dependency and removal condition. Remove dead or retired paths when that evidence exists.

## Hosted reset runbook boundary

Do not execute these steps without explicit approval of the exact reset scope.

1. Inventory the deployment revision, action/sync contracts, storage generation, account cutover state, D1 bindings, Durable Object namespace, R2 archives and browser journal identity. Record counts and immutable model/evidence identities without exposing credentials or account data.
2. Identify the disposable game IDs and their dependent rows. Preserve account/session/profile data, model assets, training checkpoints and provenance. Document whether each game has archived receipts, notes, attempts, checkpoints or R2 objects.
3. Save a recoverable snapshot/bookmark and a private reset receipt. Define who owns restoration and how the original binding/generation remains addressable.
4. Fence new writes and stale clients before resetting anything. Reconcile accepted commands first. Retire incompatible browser intent through an explicit outcome, never by pretending an unknown command failed.
5. For an unactivated guest-only database, the existing `scripts/storage-reset.mjs` may be used only within its reviewed scope and exact database identities. It refuses activated account cutover. Do not weaken that guard or reuse it to wipe account deployments.
6. An activated account deployment needs a separate game-only procedure that preserves accounts and related authority records. Prove its SQL/storage dependency scope against a disposable clone before execution.
7. Deploy compatible API before web changes and bind a new storage generation when the procedure requires it. Verify old-generation sockets, URLs and journals cannot create or revive retired games. Keep archived receipts/tombstones until their non-resurrection role has been explicitly replaced.
8. Verify fresh guest/account creation, retained account sign-in, computer play, retry/lost-response recovery, history, undo, archive/restore and boundary access. Confirm counts and artifact hashes match the approved disposition.
9. Reopen only after exact-revision evidence passes. Preserve the original snapshot and failed-attempt records. Retire old resources only under the separately approved retention plan.

Local fixture resets must also name their owned directory/database. Never clear a shared browser profile or another task's data.
