# Read-only Cloudflare investigations

Use `pnpm dlx wrangler@4.149.0` for investigation commands. The product’s pinned Wrangler is unchanged. Log in with `login --use-keyring --device`; verify with `whoami`. OAuth credentials remain encrypted with their key in macOS Keychain.

Historical observability queries require a separate account-scoped Workers Observability Edit token, even for a read-only query. Store it in the login Keychain as generic password service `righelt-cloudflare-observability`, account `righelt`. Use Keychain Access’s New Password Item dialog; never place the token in chat, shell history, tracked files, command arguments, or environment exports.

Read the password into process memory using `security find-generic-password` through a subprocess with captured output. Send it directly as the authorization header to Cloudflare’s telemetry query API; never log the credential or raw request headers. Queries use `dry: true`, a bounded timeframe, and filters for the relevant service/game. Print only allowlisted timings, statuses, event IDs, versions, and connection details. Do not print raw logs containing IPs, location, cookies, or credentials.

D1 queries must be SELECT-only for investigations. Do not join or mutate the reported game. Durable receipts prove accepted/rejected commands; an HTTP 200 alone does not prove the browser consumed a receipt. Sampling, retention, or absent logs cannot prove an event did not occur.

The October 11 incident crossed API versions near deployment. Both push and retreat were accepted; client receipt consumption remains unobserved. Use disposable local games for reproductions and keep production reads distinct from test mutations.
