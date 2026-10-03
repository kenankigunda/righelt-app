# Account cutover and rollback

T-108.07 supplies an account-safe release and operator controls. This document does not authorize a deployment, activation, paid upgrade, or weakening the password hash. The outstanding deployed hashing metrics and physical iPhone/in-app-browser acceptance remain separate evidence requirements.

## Safety boundary

Apply migration `0013_account_cutover.sql` before deploying this server. An unreadable or missing policy row returns a temporary failure; it never chooses guest mode. The initial row explicitly permits the existing pre-cutover deployment. Starting maintenance blocks game writes even before permanent activation, allowing the canary account to be provisioned through normal registration.

Activation records an immutable timestamp and immutable canary account ID. It cannot be undone with the operator tool. Database triggers reject legacy game writes, deletes and child-record writes after activation, even from an older server. Account writes require a short-lived permit inserted and removed inside the same D1 batch as the session guard, game revision guard, projection, invitations, event and receipt. A failed guard rolls back the whole batch. Presence cleanup cannot grant play authority and does not run during maintenance.

`AUTH_ENABLED` controls credential-service availability. It does not override the permanent database requirement. With it disabled after activation, public game reads and minimal profiles remain available, while game writes fail closed. Bootstrap is non-cacheable and reports account requirement, availability and maintenance separately. Old authenticated sockets recheck policy and server session before personalized output; legacy protocol sockets lose authority.

During maintenance, the only game writes allowed are from the configured acknowledged canary account, using normal Origin checks, password login, secure cookies and session context. Both seats must belong to that account and the game must be a server-marked canary self-play game. The public UI remains paused even for the canary; the smoke runner uses ordinary authenticated Pages requests. No header, debug route or client identity grants an exception. Normal public browsing continues.

## Prepare the deployment

1. Record the current release and a D1 Time Travel bookmark. The Free plan retains seven days; verify the bookmark and a recovery procedure before changing state. Export a protected backup if a longer retention period is required. Backups contain credential hashes and must not be published as test artifacts.
2. Apply additive migrations through `0013`. Existing games receive explicit `legacy_guest` ownership through `0012`; no seat, approval or journal is migrated.
3. Configure the Dev environment variables: `RIGHELT_SITE_ORIGIN` (one exact HTTPS origin), `RIGHELT_AUTH_ENABLED`, `AUTH_TURNSTILE_SITE_KEY`, `ACCOUNT_SMOKE_LEGACY_GAME_ID` (a preserved legacy game for deployed read/write checks), and existing Cloudflare account/database/Pages settings. `CLOUDFLARE_API_BASE_URL` is the former public API origin, used only to verify that it is no longer accessible.
4. Configure `AUTH_HMAC_SECRET` (32 random bytes, lowercase hex) and `TURNSTILE_SECRET` in the environment secret store. Keep their values out of shell history, files committed to Git, logs and command arguments. The deployment helper passes secrets to Wrangler through stdin.
5. First deploy this account-safe release with `RIGHELT_AUTH_ENABLED=false`, while the initial policy still permits pre-cutover play. Verify public reads before entering maintenance. This ordering prevents an older server from attempting presence writes on public reads after writes are paused.
6. Set maintenance with `node scripts/account-cutover.mjs pause --remote`, with `CLOUDFLARE_D1_DB_NAME` configured. Reads remain available; stale guest writers are denied by SQL triggers. The operator must verify `status` reports maintenance before continuing.
7. Deploy with `RIGHELT_AUTH_ENABLED=true`. For the first provision only, use the manual deployment input `prepare_accounts=true`. This deploys the private hash Worker, private admission Worker, private API and Pages, then requires bootstrap to report closed maintenance. It deliberately does not claim account smoke acceptance or reopen play.
8. Register the dedicated canary through Pages, save its recovery code and acknowledge it. Record the immutable account ID from the authenticated session response in `ACCOUNT_CANARY_ID`. Keep the username/password in `ACCOUNT_SMOKE_USERNAME` / `ACCOUNT_SMOKE_PASSWORD` secrets. The canary must not be an ordinary player's account. No direct credential-row insertion is permitted.

The API and both authentication Workers set `workers_dev=false` and `preview_urls=false`. Pages reaches the API through `API_SERVICE`; the API reaches private admission through `HASH_SERVICE`. Remove any previously configured public routes/custom domains and confirm the negative direct-API check. Account requests are same-origin through Pages; no cross-origin cookie forwarding is supported. Preview deployments must use separate databases and explicitly separate service names: service bindings must never accidentally point an isolated preview at production resources.

## Activate and prove the release

1. With maintenance still closed, run `node scripts/account-cutover.mjs activate --remote`. Activation verifies the configured canary exists and has acknowledged recovery. Read `status` afterward and record the release, timestamp and account ID. Repeating activation for the same account is safe; another account ID is rejected.
2. Run the normal deployment smoke, or `node scripts/account-smoke.mjs` with the site origin and canary credentials supplied from the secret store. It verifies no-store responses, secure host-only cookies, account-owned self-play, the same seat in a second cookie jar, identity spoof rejection, password-change revocation and logout. The password is changed to the same value so secret-store rotation is unnecessary; recovery is unchanged. The resulting canary game is excluded from ordinary home listings.
3. Confirm public legacy game and invite links remain viewable and all legacy mutations fail. Confirm the Pages service binding works and the direct API is private. Use the real-browser acceptance matrix for socket revocation, cross-browser invite continuity, no stale command replay and the preserved board. The Node smoke is not a substitute for those browser checks.
4. Review the smoke results and monitoring, then explicitly run `node scripts/account-cutover.mjs reopen --remote`. The deployment workflow never reopens play automatically. Failed smoke leaves maintenance closed. Run `status` and a normal account play check after reopening.

`status`, `activate`, `pause` and `reopen` are the only operator commands. They use Wrangler D1 access, not a deployed administration endpoint. Pause/reopen update one singleton row. Activation is one constraint-checked statement; no partially completed credential operation is involved. D1 primary reads and transaction ordering define the cutoff: a game batch committed before maintenance may complete; one evaluated afterward must be denied unless it is the canary self-play exception.

## Rollback and monitoring

Pause first. Revert only to this release or a later release that understands the permanent marker, required-account protocol and database permits. Disabling credential availability is safe but does not reopen play. The old DB Retention Cleanup workflow is retired for account cutover: its destructive operations are blocked by the preservation triggers. Do not weaken those triggers to run it. Never restore guest-authorized writers, delete the cutover row/triggers, or use a pre-cutover snapshot as a routine rollback. Disaster recovery from an older backup requires restoring the account-required boundary and validating account/session consistency before exposing any writer.

Monitor aggregate authentication failures, throttling, hashing latency/resource errors, D1 guard conflicts, revocation delivery and legacy write rejection. Do not record request bodies, passwords, recovery codes, cookies or tokens. Preserve history and legacy links; leave old client journals retired.

## Local evidence and fixture controls

Run the API unit/integration suite and `pnpm test:sync-runtime` for real local D1 and socket checks. The cutover runtime test proves immutable activation, old-writer rejection, restricted canary maintenance writes, missing-marker failure, public reads with account services disabled and maintenance racing a game transaction without a persisted candidate or leaked permit. Browser coverage is in `e2e/auth/cutover.spec.mjs`.

The isolated account runner seeds `cutover-legacy-fixture` and `cutover-legacy-invite` before startup. Its separate loopback port accepts fixed `/activate-cutover` (acknowledged `cutover_canary` only), `/maintenance-on`, `/maintenance-off`, `/reset-limits` and `/expire-sessions` fixture operations. It rejects browser-origin requests. Activation remains permanent across cases and engines; maintenance must be reopened in test cleanup. These controls exist only in the local runner, never in deployed Workers or Pages.
