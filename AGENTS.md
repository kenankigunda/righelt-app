# AGENTS.md

This file defines repo-specific operating rules for AI coding agents working in `/Users/kenankigunda/Documents/righelt/righelt-app`.

If the parent workspace `/Users/kenankigunda/Documents/righelt` is what is currently opened in Codex or Claude, treat `righelt-app` as the default git-aware execution root unless the task explicitly targets the sibling backlog repo.

The tracked sources of truth for the parent workspace bootstrap files live in `docs/ai/WORKSPACE_ROOT_AGENTS.template.md` and `docs/ai/WORKSPACE_ROOT_CLAUDE.template.md`; refresh the actual parent files with `pnpm setup:workspace`.
Whenever you change parent-workspace guidance or discoverability, update the relevant tracked template(s) in the repo and regenerate the parent `/Users/kenankigunda/Documents/righelt/AGENTS.md` and `/Users/kenankigunda/Documents/righelt/CLAUDE.md` in the same change so the live workspace files stay aligned with the tracked templates.
The parent workspace files must make it obvious that `/Users/kenankigunda/Documents/righelt/righelt-app/AGENTS.md` contains the full repo operating manual, including team shorthands, testing policy, branch/worktree rules, and backlog workflow instructions.

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

## 5.2) Scenario Terminology

- In this repo, `scenario` means a scenario record from `apps/web/scenarios/catalog.json`.
- Do not use `scenario` to refer to engine golden fixtures, parity fixture sets, or other legacy fixture artifacts.
- If older code or docs mention golden fixtures, treat that as legacy terminology and translate it mentally to either:
  - catalog-backed scenarios, if the context is current runtime/debug UX
  - legacy test artifacts, if the context is historical cleanup work
- When adding new code, docs, tests, or backlog tasks, use `catalog scenario` or just `scenario` for `catalog.json` entries and use `legacy fixture artifact` if you must mention the old data at all.

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
- Ticket kick-off (`Tk` = **T**icket **K**ick-off) — uses the workflow in `docs/ai/TICKET_WORKFLOW.md`:
  - `Tk [t-###]` = kick off ticket: assign Lead, route by label (feature → PM + UXD + Architect; bug → PM + UXD + Architect; improvement → Architect only), run through Eng and final Tester validation
  - `Tkpm [t-###]` = run only the PM step for a ticket (spec must not yet exist)
  - `Tkuxd [t-###]` = run only the UXD step for a ticket (spec must already exist and still need visual-design refinement)
  - `Tka [t-###]` = run only the Architect step (spec must already include UX refinement, or ticket is an improvement)
  - `Tke [t-###]` = fan out Eng subtasks from an existing eng plan
  - `Tkv [t-###]` = run the Lead's final end-to-end Tester validation pass
  - Codex implementations should use the shared canon in `docs/ai/ticket-workflow/`, the `skills/ticket-*/SKILL.md` adapters, and the backlog wrapper scripts rather than MCP-only assumptions
- Sprint flows — uses the workflow in `docs/ai/TICKET_WORKFLOW.md`:
  - `Ps` = **P**lanning **S**print: drive all eligible tickets that are not yet `Ready for execution` through spec + visual design + eng planning to `Ready for execution`
  - `Ps [type]` = planning sprint filtered to a ticket type such as `feature`, `bug`, or `improvement`
  - `Ps [milestone]` = planning sprint filtered to a backlog milestone such as `Friend play alpha`
  - `Ps [type] in [milestone]` = planning sprint filtered to both ticket type and backlog milestone, such as `Ps features in friend play alpha`
  - `Es` = **E**xecution **S**print: drive all `Ready for execution` tickets through implementation + review to `Ready for acceptance`
  - `Es [type]` = execution sprint filtered to a ticket type such as `feature`, `bug`, or `improvement`
  - `Es [milestone]` = execution sprint filtered to a backlog milestone such as `Friend play alpha`
  - `Es [type] in [milestone]` = execution sprint filtered to both ticket type and backlog milestone

## 7) Backlog

The backlog lives in a **separate sibling repo** (`../righelt-backlog` relative to this repo), always on `main`. It is the single source of truth for all task files, ticket docs (spec, eng-plan, test-plan, coordination-log), and authoring templates. It is not tracked by this repo's git history.

Full ticket workflow: `docs/ai/TICKET_WORKFLOW.md`.
Codex workflow setup check: `node scripts/check-ticket-workflow-setup.mjs`.

**Write path (preference order — same sync bookends for both):**

| Priority | Path | When to use |
|----------|------|-------------|
| 1 | `./scripts/backlog.sh` CLI wrapper | Always preferred |
| 2 | Direct file edit in backlog repo | Last resort only |

Before any backlog write, pull the latest from the shared repo. After any write, push so other worktrees see the change:
```
./scripts/backlog-git.sh pull --rebase origin main   # before write
./scripts/backlog-git.sh push origin main            # after write
```
For direct file edits (path 2), also commit manually before pushing:
```
./scripts/backlog-git.sh commit -am "chore(backlog): update t-### <reason>"
```
`scripts/backlog.sh` wraps the `backlog` CLI and resolves the repo path dynamically (no hardcoded paths). `scripts/backlog-git.sh` runs git commands against the shared backlog repo from any worktree.

**Reference artifacts:** when a backlog task or ticket doc mentions a screenshot, mock, or other reference artifact, copy that file into the backlog repo (typically `backlog/assets/`) before or alongside the task/doc write, reference the repo-backed path from the markdown/task metadata, and include the artifact in the same push. Do not leave task descriptions pointing only at ad hoc local paths or unattached filenames.

**Conflict policy:** task files are one file per ID — concurrent writes to different tickets never conflict. If two agents write the same task concurrently, the second push fails; that agent should `pull --rebase` and re-attempt.

**Branch and worktree tracking:** when a ticket moves to In Progress, the Lead sets these optional frontmatter fields on the parent task:
```yaml
branch: "claude/funny-mayer"
worktree: "funny-mayer"
```
Clear (or leave as audit trail) when the ticket moves to Ready for acceptance.

**Ticket documents** (spec, eng-plan, test-plan, coordination-log) are stored in the backlog repo under `backlog/docs/tickets/t-###/`. Authoring templates are at `backlog/docs/SPEC_TEMPLATE.md` and `backlog/docs/ENG_PLAN_TEMPLATE.md` in the backlog repo. When agents write these files, they write to the backlog repo path, not to the main repo.

- Use `./scripts/backlog.sh task create`, `task edit`, `task archive`, and `task view` for all task operations so filenames and metadata stay consistent.
- Edit task files directly only when the `backlog` CLI is unavailable or cannot perform the required operation.
- Canonical active task filenames follow `backlog/tasks/t-### - <CLI slug>.md`. Subtasks follow `t-###.NN - <CLI slug>.md`.
- **Completed/archived tasks** are moved to `backlog/completed/` by `task archive`. If a ticket ID referenced in dependencies or other docs cannot be found in `backlog/tasks/`, check `backlog/completed/` before concluding it does not exist.
- The `<CLI slug>` is not the raw title. Match the CLI naming shape:
  - replace spaces with `-`
  - remove separator punctuation such as `/`, `:`, commas, apostrophes, brackets, and parentheses instead of preserving them as spaces
  - preserve meaningful token characters the CLI keeps, such as `.` inside names like `Backlog.md`
  - collapse repeated hyphens and trim leading/trailing hyphens
- Manual filename examples that match the CLI:
  - `History destruction record` → `t-001 - History-destruction-record.md`
  - `Use team agents + Backlog.md for more robust development` → `t-047 - Use-team-agents-Backlog.md-for-more-robust-development.md`
  - `Allow piece selection for non-active situations with limited info (historical move / viewer / non-active player)` → `t-014 - Allow-piece-selection-for-non-active-situations-with-limited-info-historical-move-viewer-non-active-player.md`


## 7) Scope of This File

- These rules are repo defaults.
- Direct user instructions take precedence.
- System/developer constraints still apply above this file.
