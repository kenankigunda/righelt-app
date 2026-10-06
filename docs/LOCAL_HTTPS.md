# Trusted local HTTPS

Wrangler's default HTTPS certificate is self-signed. Each computer needs its own
trusted development CA and certificate. Do not disable browser certificate checks.

## Setup and normal use

Install [mkcert](https://github.com/FiloSottile/mkcert), then run:

```sh
pnpm setup:https --install-trust --all-worktrees
pnpm setup:https --check
pnpm dev:https
```

On macOS, `brew install mkcert` installs the tool. Installing trust may require an
administrator password. Firefox may also need `brew install nss`, another
`mkcert -install`, and a browser restart. For trust limited to your macOS account,
import mkcert's `rootCA.pem` into the login keychain with Keychain Access and trust
it for SSL. `mkcert -CAROOT` shows its location. Keep the CA private key private.

`dev:https` starts the web and API stack on the normal local ports, with HTTPS on
the web server. Other existing development commands keep their existing protocol.
The account stack also uses HTTPS. Hosted deployments are unaffected.

The shared certificate lives in `~/.config/righelt/https`. It covers `localhost`,
`127.0.0.1`, and `::1` on every port. Setup checks its lifetime, names, private key,
and signature against the current mkcert CA. It refuses a certificate that expires
within 30 days. A changed CA requires certificate renewal and trust installation:

```sh
pnpm setup:https --renew --install-trust --all-worktrees
```

Restart HTTPS servers after renewal or configuration changes. A running server
keeps its old certificate. Preserve temporary account-stack data before restarting;
that stack deletes its temporary database on shutdown.

## Check the server and browsers

Use the URL of the running server:

```sh
pnpm setup:https --check --url https://127.0.0.1:9988
pnpm check:https https://127.0.0.1:9988
pnpm test:https
```

`--check` makes no changes. Without a URL, it checks the shared certificate, current
CA, and macOS trust. With a URL, it also checks that the server presents the exact
shared certificate and completes a request using the system trust store.
`check:https` additionally opens the URL in fresh Chromium, Firefox, and WebKit
contexts with certificate checks enabled. It requires installed Playwright browsers.
`test:https` starts and cleans up a real Wrangler server in a temporary directory
without environment files, then checks all three browsers on localhost, IPv4, and
IPv6. These two commands are supervised and intended for a developer computer with
trust installed; they are not a replacement for application E2E tests.

The trust probe ignores curl configuration and CA override variables. This prevents
an old `insecure` workaround or a supplied CA bundle from producing a false pass.
Application tests that use `ignoreHTTPSErrors` still exercise application behavior,
but do not prove browser trust. CI retains its isolated development certificates.

If a browser still shows a privacy warning:

- A different served certificate means that server needs the current settings and a restart.
- A matching but untrusted certificate means the issuing CA needs trust in that browser or computer.
- Firefox profiles, embedded browsers, and other devices may have separate trust stores. Test the affected browser itself and restart it after installing trust.
- A LAN hostname or IP is outside this certificate's loopback names. Use a separately issued certificate covering that address and install its CA on the client device.
- Connection refusal or a protocol error means no HTTPS server is listening at that URL. Installing trust does not turn an HTTP server into HTTPS.

## Worktrees, custom settings, and validation tools

Setup writes the two [Wrangler HTTPS settings](https://developers.cloudflare.com/workers/wrangler/system-environment-variables/)
into ignored `.env.local` files at each checkout root and in `apps/web` and
`apps/api`. It preserves unrelated values and refuses custom certificate settings,
tracked environment files, or symlinks. It leaves the pinned validation-tools
checkout alone.

The HTTPS development, auth-test, and updated account-validation launchers resolve
certificate settings before spawning Wrangler. Custom settings take precedence;
the launchers retain Wrangler's dotenv expansion and resolve relative paths from
the launch directory. An incomplete, missing, expired, or mismatched custom pair
fails rather than silently falling back. Without custom settings, local launchers
use the shared certificate directly. This also works in new temporary checkouts
that do not inherit ignored files. Only the certificate paths are forwarded; other
file values are left to Wrangler. CI does not automatically adopt personal files.
On macOS, these HTTPS launchers also verify system trust before starting Wrangler.
An untrusted CA fails with recovery instructions before opening the browser.

Older branches or launchers that call Wrangler directly still need setup:

```sh
pnpm setup:https --all-worktrees
node /path/to/scripts/setup-local-https.mjs --root /path/to/checkout
```

The account-validation launcher change becomes active in the released harness only
after merging and explicitly updating the pinned installation. Until then, configure
new candidate worktrees before starting the released harness. Candidate edits do
not modify the installed harness automatically.

## Why the earlier fix was incomplete

The first fix configured existing worktrees and validated certificate files. It did
not cover future temporary checkouts, compare the certificate with the current
mkcert CA, or check the certificate actually served by a running process. Its
application browser tests bypassed certificate errors. Those gaps allowed a valid
file on disk and a successful application test to coexist with a browser warning.
The shared launch-time fallback and strict server/browser probes cover these gaps.

To undo setup, remove each `BEGIN Righelt local HTTPS` block through its matching
`END` line and restart servers. The updated launchers also use the shared pair when
no custom settings exist, so stop using HTTPS or configure another valid pair if
you remove it. Remove trust with `mkcert -uninstall`, or Keychain Access for a
manually installed login-keychain certificate.
