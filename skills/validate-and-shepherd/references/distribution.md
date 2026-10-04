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

After installation, run `pnpm setup:workspace` from the canonical `righelt-app` checkout at the released revision to regenerate parent instructions from the released templates. This is separate from developing/reviewing an unmerged tooling candidate; do not apply unreleased parent guidance or install the personal adapter prematurely.

Example released invocation:

```sh
node /absolute/righelt-validation-tools/scripts/validation/cli.mjs local --candidate /absolute/feature-worktree --base origin/main
node /absolute/righelt-validation-tools/scripts/validation/cli.mjs integrated --candidate /absolute/righelt-app --manifest /absolute/manifest.json
```

If the released tools or dependency runtime are missing, report the exact setup gap and prepare the installation command. Do not silently fall back to arbitrary branch-local tools. Developing the tooling itself uses an isolated explicit test candidate; it is not an installed release or permission to replace the user's personal skills.

The optional `--update-shipping-skills` flag narrowly replaces the personal `ship-worktree` skill's blanket visual-suite rerun with affected checks plus the repository-required final pass. It preserves unrelated contents and backs up a changed file. This remains repository-neutral; other repositories keep their own required gates. Audit other shipping guidance for concrete conflicts before making further edits.
