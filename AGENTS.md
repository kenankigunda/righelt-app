# AGENTS.md

This file defines repo-specific operating rules for AI coding agents working in `/Users/kenankigunda/Documents/righelt`.

## 1) Core Principles

- Optimize for safe, incremental delivery over heroic one-shot changes.
- Keep changes scoped to the user request and current feature plan.
- Prefer explicit acceptance criteria, deterministic commands, and auditable logs.
- Do not silently change conventions; propose first when in doubt.

## 2) Skills Contract

- Skills are turn-scoped. Re-mention required skills in each turn where they should apply.
- Non-default workflows belong in dedicated docs under `docs/ai/`.
- If a referenced skill is missing or unreadable:
  - state the issue briefly
  - continue with best-effort fallback using these AGENTS rules
  - avoid blocking unless the missing skill is strictly required

## 3) Worktree and Branch Conventions

- Branch convention: `codex/<short-topic-slug>`
- Reuse existing matching worktrees/branches when possible.
- Never delete worktrees or branches unless the user explicitly asks.

## 4) Testing Policy

- Testing layers are standardized repo-wide:
  - `unit test` = one module/component in isolation
  - `integration test` = multiple components/subsystems or contract boundaries together
  - `E2E test` = the full browser workflow against the real local web + API stack
- Run only tests relevant to touched packages for the current change.
- Run required acceptance checks before final integration.
- Treat the repo-level full verification flow as `pnpm test`, and keep it aligned with CI checks so local full-pass validation catches the same classes of failures.
- If tests cannot run, state why and what remains unverified.
- Prefer deterministic, non-watch test commands in agent execution.
- Add and/or extend a comprehensive test set for the changed behavior, with explicit regression-focused assertions.
- Every behavioral change is expected to add or update `unit + integration` coverage unless it is purely non-functional.
- Every touched workflow must explicitly consider whether its `E2E` coverage should be added or expanded.
- Keep workflow success proof in `E2E` and keep variant/permutation depth in `integration` tests to avoid redundant browser matrices.
- Treat regression hardening as a default requirement for every change: run the full relevant test pass, add or extend tests for the changed behavior, cover nearby/adjacent workflows that could be affected, and include edge cases or tricky state transitions that could plausibly regress.
- Test plans should map expected behavior to source references such as spec sections, test matrix rows, and identified gaps requiring new tests.
- Validated correctness is a hard gate: do not advance a change to the next development step until required tests for the current step pass.


## 5) Git Safety and Change Hygiene

- Never use destructive git/file operations unless explicitly requested.
- Do not revert unrelated user changes in a dirty tree.
- Prefer non-interactive git commands.
- Keep commits/changes scoped to the active task and acceptance criteria.

## 5.1) Shared Constants Policy

- Any constant that defines shared runtime behavior, protocol semantics, cache policy, validation rules, game invariants, or other cross-module behavior must have a single source of truth.
- Generated files may mirror shared constants for runtime packaging, but they are never authoritative; update the source module first, then regenerate outputs.
- Do not duplicate shared constants across app, API, scripts, and tests when consumers can import the authoritative source safely.
- Exception: tests may keep literal values when they are asserting an external/public contract and importing the implementation constant would make the test tautological.

## 6) Communication Expectations

- State assumptions explicitly when inputs are incomplete.
- Before substantial edits, summarize intended action briefly.
- Report blockers early with concrete next options.
- Keep status updates concise and operational.

## 6.1) Team Shorthand

Shorthands are case-insensitive (for example: `cp = CP = Cp`).

- `Cp` = commit + push + wait before continuing
- `Cpn` = commit + push + take the next action
- `Opr` = open a PR and give me the link
  - PR descriptions should always use bullet points written in Sentence case.
- `Dd` = do a deep investigation to understand holistically, give your diagnosis, and propose a change; wait before implementing
- `Dfix` = diagnose and fix
- `Ddfix` = do a deep investigation to diagnose and fix holistically
- `Rgr` = regression hardening pass: run the full relevant test pass, add or extend regression tests for the changed behavior and adjacent workflows, cover important edge cases, and report any remaining coverage gaps
- `Fhr` = fragility hardening review: use the workflow in `docs/ai/FRAGILITY_HARDENING_WORKFLOW.md` to think like a tester, identify creative failure modes and fragile adjacent behavior, verify them with targeted tests, fix issues found, and report any remaining risks
- `Tt` = use the tester skill to validate your work and make the corresponding fixes
- `Sb` = switch branch; expects either an explicit branch name or a description that can be used to infer the intended branch
- `Snb` = switch to a new `codex/` branch whose name is auto-derived from the most recent non-`main` changes in flight; reuse the active feature/topic slug when clear, otherwise derive a short descriptive slug from the latest branch/commit context and append a disambiguating suffix if needed
- `Snbom` = `Snb` off of `origin/main`
- `Sbtb` = switch back to this branch
- `Audit branches` = run the detailed branch audit workflow in `docs/BRANCH_AUDIT_WORKFLOW.md` and update `docs/BRANCH_AUDIT.md`
- `Aubr` = `Audit branches`
- `Cleanup branches` = use the latest on-disk contents of `docs/BRANCH_AUDIT.md` as the pre-cleanup baseline, rerun `Audit branches`, including updating `docs/BRANCH_AUDIT.md` when the audit changes, and stop if the refreshed audit differs from that baseline file state, reporting the difference; do not compare against only the last committed version; never modify `main`; before any local-only branch deletions, update `docs/REMOTE_ONLY_BRANCH_SUMMARIES.md` as needed for branches that will remain remote-only; then delete `(a)` branches from local and remote, delete `(d)` branches from local only, delete `(e)` branches from remote only, and remove summary entries from `docs/REMOTE_ONLY_BRANCH_SUMMARIES.md` after confirming the corresponding remote branches were deleted
- `Clbr` = `Cleanup branches`
- `Rbom` = rebase on latest origin main
- `Fp` = force push (`--force-with-lease`)
- `Mmp` = merge to main and push

## 7) Scope of This File

- These rules are repo defaults.
- Direct user instructions take precedence.
- System/developer constraints still apply above this file.
