# Authentication implementation

T-108 adds first-party username/password accounts with a recovery code and no email. The authoritative product, engineering and acceptance plans are in the sibling backlog repository under `backlog/docs/tickets/t-108/`.

## Rollout boundary

Credential endpoints are disabled unless `AUTH_ENABLED` is exactly `true`. This stage does not enable accounts in the deployed application or replace game authorization. Do not enable it in production until the game, client and cutover stages of T-108 are complete. The synthetic hashing experiment has partial deployed measurements; its missing resource evidence remains recorded separately in `tools/t108-feasibility/evidence/RESULTS.md`.

## Runtime configuration

| API binding or setting | Purpose |
| --- | --- |
| `DB` | D1 database with migration `0011_accounts.sql` applied. |
| `HASH_SERVICE` | Private service binding to the admission Worker, `righelt-auth`. |
| `AUTH_ENABLED` | Explicit credential-route activation. Unset means disabled. |
| `AUTH_ALLOWED_ORIGINS` | Comma-separated exact origins, including scheme and any port. No wildcard or trailing slash. |
| `AUTH_HMAC_SECRET` | Secret containing 32 independently random bytes encoded as 64 lowercase hexadecimal characters. Used for domain-separated recovery-session derivation and private counter keys. |
| `TURNSTILE_SECRET` | Server-side challenge validation secret. Required when an attempt reaches the challenge threshold. |

Keep secrets in the provider's secret store. Do not place credentials, recovery codes, cookies, request bodies or secret values in logs or repository files. Losing or changing the HMAC secret prevents retries of previously prepared recovery flows; it does not replace the password or recovery-code verification policy.

The two private Workers use separate SQLite-backed Durable Objects. `apps/auth/wrangler.toml` binds its `HASH_ENGINE` service to `righelt-auth-hash`, configured in `apps/auth-hash/wrangler.toml`. Neither Worker has a public route. Admission allows one active hash and four waiting requests. There is no weaker-hash fallback.

## Request and session contract

Account responses are non-cacheable. JSON mutations require an exact allowed `Origin`, `Content-Type: application/json`, and `X-Righelt-Auth: 1`. An authenticated mutation also supplies the public `X-Righelt-Session` context returned by session hydration. The context detects browser-account changes; it never selects the actor.

The opaque session cookie is Secure, HttpOnly, SameSite=Lax and host-only. Server expiry is 30 days after accepted activity. Reading `/api/auth/session` does not renew it. Successful explicit activity renews both the database expiry and cookie lifetime; a completed recovery retry preserves the existing expiry. The database clock decides expiry, including within guarded transactions.

Registration returns a recovery code once and creates a restricted session. Saving and acknowledging that exact code version permits play once game authorization is integrated. Password login can resume an incomplete account; password-authenticated code replacement provides a new code if the first response was lost.

Recovery preparation lasts ten minutes and does not change credentials. Acknowledgment atomically replaces the password and recovery code, revokes old sessions, and issues the recovering browser's session. Repeating a completed finish returns that same session only while it is still active and the credential generation matches. A narrow retry also handles the browser accepting the cookie but losing the response body. Logout, or successful login/registration with that browser's flow cookie, invalidates the flow on the server. Clearing a cookie alone is insufficient.

An ordinary password change requires the current password, preserves the recovery code, and replaces sessions. Password-authenticated recovery-code replacement activates only on acknowledgment and preserves existing sessions. Failed credential transitions preserve the prior session and recovery flow.

## Validation and maintenance

`packages/shared-types/data/README.md` records the pinned common-password source and license. Regenerate its runtime JSON with `node scripts/generate-auth-password-blocklist.mjs`; tests compare it to the vendored text. No network download occurs during authentication.

Run `pnpm typecheck` and `pnpm test:api-handler` for credential changes. The suite includes isolated request-control tests, real local D1 transaction and concurrency tests, and private hashing-service runtime tests. Local tests do not satisfy the outstanding deployed resource measurements or physical-device acceptance.

Persistent abuse counters are checked before hashing. Expired counter rows are removed in bounded batches during admission. Challenges never bypass hard limits. Unavailable hashing or challenge services return a temporary failure without weakening verification.
