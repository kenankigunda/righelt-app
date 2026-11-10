# Released tools and candidate separation

`righelt-validation-tools` is a dedicated detached checkout of a merged app-repository revision. It owns the validation skill, runner, browser harness and report publisher. The app checkout being validated is always an explicit `--candidate /absolute/path`; changing a feature branch does not change the installed policy or harness.

The tracked installer is `scripts/install-validation-tools.mjs`. With no `--install` it reports a read-only plan against the locally known `origin/main`. Installation contacts GitHub, so invoke it with scoped outside-sandbox execution. It fetches actual main, verifies the pinned revision belongs to its history, creates a detached sibling checkout, and writes a small `~/.codex/skills/righelt-validation/SKILL.md` adapter. It does not install dependencies, run tests, start an automation or change provider settings. Install frozen dependencies in the released checkout as a separate authorized setup step.

After this tooling change actually merges, the operator can review and execute:

```sh
node scripts/install-validation-tools.mjs --source /absolute/righelt-app
node scripts/install-validation-tools.mjs --source /absolute/righelt-app --install
```

The default revision is freshly fetched `origin/main`; `--revision MERGED_SHA` pins a specific merged release. Existing installations must be clean and detached. Changing the pinned revision also requires `--update`; the installer never resets local work. Preserve the old revision in evidence before an update. Dependencies such as ignored `node_modules` remain separate from tracked tools. Every run records the actual harness revision/fingerprint.

Personal skill changes are explicit external writes. `--update-gh-watch` adds installation of the tracked `docs/ai/GH_WATCH_AND_REPAIR_PR_SKILL.template.md` into that one personal skill; it is never applied by default. Changed skill files receive a local backup. No other personal skill is modified. Review the template diff before requesting this option.

After installation, run `pnpm setup:workspace` from the canonical `righelt-app` checkout at the released revision to regenerate parent instructions from the released templates. This is separate from developing/reviewing an unmerged tooling candidate; do not apply unreleased parent guidance or install the personal adapter prematurely. If the canonical app checkout is on unrelated work, do not switch it or run the broad workspace setup from a differently named tools checkout. Instead, after installation, back up and render only the two parent instruction files from the installed release templates, substituting the fixed canonical app/backlog/tools paths. Verify exact output and resolved placeholders; leave settings, links and the unrelated checkout unchanged.

Example released invocation:

```sh
node /absolute/righelt-validation-tools/scripts/validation/cli.mjs local --candidate /absolute/feature-worktree --base origin/main
node /absolute/righelt-validation-tools/scripts/validation/cli.mjs integrated --candidate /absolute/righelt-app --manifest /absolute/manifest.json
```

If the released tools or dependency runtime are missing, report the exact setup gap and prepare the installation command. Do not silently fall back to arbitrary branch-local tools. Developing the tooling itself uses an isolated explicit test candidate; it is not an installed release or permission to replace the user's personal skills.

The optional `--update-shipping-skills` flag replaces the personal `ship-worktree` skill's blanket visual-suite rerun with affected checks plus the repository-required final pass, and installs an idempotent Righelt-only PR-gate policy section. It preserves unrelated contents, rejects malformed policy markers and backs up a changed file. Other repositories keep their own required gates. The generated `righelt-validation` adapter and opt-in watcher template carry the same CI policy: only exact current-head `PR validation` is blocking; `Full validation` is retired and nightly is advisory. After this release, install with `--update --update-gh-watch --update-shipping-skills` to update all three relevant personal skills.

## History selection compatibility

The released account Undo journey selects its History hit target before browser activity. Candidates without `apps/web/shell/history-narration.js` use the original information-row click. A present module must declare the literal exported `HISTORY_HIT_TARGET_CONTRACT='move-button-v1'`, which selects the direct native move button on the same immutable move-ID row. Missing, ambiguous or unknown declarations fail closed. The forwarded contract is required by the helper, with no runtime fallback after a failed click.

Merge and install the compatible tooling release before running official fresh or retained account validation against that History layout. Development controls of unmerged tooling do not replace released validation. This adapter changes no Undo command, receipt assertion, deadline or product behavior. Report publication and paused schedules remain unchanged.
