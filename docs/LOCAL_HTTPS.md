# Trusted local HTTPS

Wrangler's default HTTPS certificate is self-signed. Browsers reject it unless a
trusted development certificate is configured. Each computer needs its own local
CA and private key. Do not trust Wrangler's bundled certificate or disable browser
certificate checks.

Install [mkcert](https://github.com/FiloSottile/mkcert), then run:

```sh
pnpm setup:https --all-worktrees
mkcert -install
```

On macOS, `brew install mkcert` installs the tool. The trust step may require an
administrator password. It installs a CA that can issue certificates trusted by
your computer; keep its private key private. Firefox may also require the `nss`
package and a browser restart. If you only want trust for your macOS user account,
use Keychain Access to import mkcert's `rootCA.pem` into the login keychain and
explicitly trust it for SSL. `mkcert -CAROOT` shows its location.

The setup command creates or reuses a certificate in `~/.config/righelt/https`,
covering `localhost`, `127.0.0.1`, and `::1` on every port. It writes the two
[Wrangler HTTPS path settings](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
into ignored `.env.local` files at the checkout root and in `apps/web` and
`apps/api`. Existing unrelated settings remain intact. Existing custom HTTPS
settings cause an error rather than being overwritten. The released validation
tools checkout is left alone; its candidate apps use their own configuration.

Restart any running HTTPS servers after setup. This includes the account stack on
port 9988. Preserve any temporary account-stack data before restarting it; that
stack deletes its temporary database on shutdown. Restart browsers if they still
show a cached certificate warning.

For a new worktree, run `pnpm setup:https` there, or rerun `--all-worktrees` from
the checkout containing this script. Older branches can be configured with
`node /path/to/scripts/setup-local-https.mjs --root /path/to/checkout`.
The command never installs trust or restarts servers itself. Existing HTTP
entrypoints stay HTTP; these settings apply whenever Wrangler is started with
`--local-protocol https`. Hosted deployments are unaffected.

To renew, run `pnpm setup:https --renew --all-worktrees` and restart HTTPS servers.
The command rejects certificates that expire within 30 days, omit a loopback
address, or do not match the private key. Certificate validation here checks the
files; it does not establish browser trust.

Verify without a certificate bypass:

```sh
curl -I https://localhost:9988
curl -I https://127.0.0.1:9988
```

Both must complete without certificate errors, and the browser must open the page
without a privacy warning. Automated tests using `ignoreHTTPSErrors` are not proof
of browser trust. CI can keep using its isolated development certificates.

To undo the configuration, remove the `BEGIN Righelt local HTTPS` block through its
matching `END` line from each generated `.env.local` file and restart the servers.
Trust can be removed with `mkcert -uninstall` (or Keychain Access for a manually
installed login-keychain certificate).
