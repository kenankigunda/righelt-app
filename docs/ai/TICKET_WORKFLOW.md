# Ticket Workflow

This document captures the non-default workflow for ticket-driven development using agent teams. Use it when kicking off a ticket from the backlog through spec, visual design, eng planning, implementation, and validation.

## When To Use It

Use this workflow for any ticket in `backlog/tasks/` that has been assigned to a Lead. Invoke with `Tk t-###` or a step-specific shorthand from AGENTS.md §6.1.

## Terminology

- In ticket specs, eng plans, test plans, and coordination logs, `scenario` means a catalog entry from `apps/web/scenarios/catalog.json`.
- Do not use `scenario` as shorthand for golden fixtures or other legacy fixture datasets.
- If a ticket touches historical fixture cleanup, name those artifacts explicitly as legacy fixtures rather than scenarios.

## Skills Contract

- Re-mention required skills in each turn where they should apply.
- Shared role definitions live in `docs/ai/ticket-workflow/` as the authoritative shared canon.
- Shared canon index: `docs/ai/ticket-workflow/README.md`.
- Example shared role canon: `docs/ai/ticket-workflow/lead.md`.
- Shared role canon also includes `docs/ai/ticket-workflow/product-manager.md` and `docs/ai/ticket-workflow/ux-designer.md`.
- Claude adapters live in `.claude/agents/`.
- Codex adapters live in `skills/ticket-*/SKILL.md`.
- Example Codex adapter: `skills/ticket-lead/SKILL.md`.
- Before `Tk`, `Tkpm`, `Tkuxd`, `Tka`, `Tke`, `Tkv`, `Ps`, or `Es`, run `node scripts/check-ticket-workflow-setup.mjs` so setup blockers are surfaced before the workflow starts.
- If a referenced skill or role file is missing: state the issue briefly, fall back to AGENTS.md defaults, avoid blocking unless strictly required.

## Backlog Hygiene

The backlog lives in the sibling `righelt-backlog` repo. All task files and ticket documents live there. Before any write, pull; after any write, push:

```bash
./scripts/backlog-sync.sh pull
./scripts/backlog-sync.sh push
```

If a task or ticket doc depends on a screenshot from the current product or another reference artifact, copy that artifact into the backlog repo first, normally under `backlog/assets/`, reference the repo-backed path from the task or doc, and push the artifact in the same backlog update.

Write path priority:

| Priority | When to use |
|---|---|
| 1 — `./scripts/backlog.sh` CLI wrapper | Always preferred |
| 2 — Direct file edit | Last resort; must also commit manually with `./scripts/backlog-sync.sh commit -am "chore(backlog): ..."` |

- Edit task files directly only when the `backlog` CLI is unavailable or cannot perform the required operation.
- Report a setup blocker if the sibling backlog repo, `backlog` CLI, or wrapper resolution is unavailable rather than silently falling back to ad hoc edits.
- Prefer direct command invocation for these wrappers. Use shell wrappers only when a command genuinely needs shell features such as redirection or command substitution.

## Ticket Types and Routing

| Label | Spec | Visual Design | Eng Planning |
|---|---|---|---|
| `feature` | PM | UXD | Architect |
| `bug` | PM | UXD | Architect |
| `improvement` | **Skipped** | **Skipped** | Architect |

- `feature`: PM writes a full spec, UXD refines it, Architect produces the eng plan.
- `bug`: PM writes a lightweight or full spec as needed, UXD still refines UI and interaction truth when the bug affects the user experience, Architect produces the eng plan.
- `improvement`: Architect works directly from the ticket description and any existing references unless the human explicitly decides to route it through PM or UXD.

## Backlog Status Lifecycle

`To Do` → `Spec` → `Visual Design` → `Eng Planning` → `Ready for execution` → `In Progress` → `Review` → `Ready for acceptance` → `Done`

- `Ready for execution`: product intent, UI intent, and eng plan are complete; the ticket can be autonomously implemented without further human input.
- `Ready for acceptance`: all implementation, local validation, and CI have passed; a human must review and either accept or provide feedback for further work.

Only the Lead advances status. All intermediate working state lives in `backlog/docs/tickets/t-###/coordination-log.md`.

## Execution Worktree Invariant

When a ticket moves to `In Progress`, the Lead must establish one dedicated execution worktree for that ticket. Reusing an existing worktree is allowed only when that worktree is already dedicated to the same ticket.

- The parent task `worktree` field is the canonical execution worktree for the ticket.
- The parent task `branch` field points to the ticket's execution branch.
- No other ticket may execute from that worktree until the ticket reaches `Ready for acceptance` or `Done`.
- An execution sprint may run up to 3 top-level tickets in parallel, but each active top-level ticket must have its own dedicated execution worktree.
- Parallel Eng subtasks may use additional isolated worktrees, but only when those worktrees are created specifically for the same ticket.

## Document Structure Per Ticket

Rich documentation lives in the backlog repo under `backlog/docs/tickets/t-###/`:
- `spec.md` — initially written by PM, then refined in place by UXD
- `eng-plan.md` — written by Architect
- `test-plan.md` — written by Tester during Eng Planning
- `coordination-log.md` — maintained by Lead

Authoring templates are in the backlog repo at `backlog/docs/SPEC_TEMPLATE.md`, `backlog/docs/ENG_PLAN_TEMPLATE.md`, and `backlog/docs/TEST_PLAN_TEMPLATE.md`.

When agents write these files, they write to the backlog repo, not the main repo. The backlog task file links to these docs via the `references` field using paths relative to the backlog repo root.

## Lead Execution Loop

### Step 0 — Ticket Creation
Human creates the ticket with title, label, priority, and brief description. Initial status: `To Do`.

### Step 1 — Assignment
Lead reads the ticket, sets assignee, and routes it:
- `feature` or `bug`: status → `Spec`
- `improvement`: status → `Eng Planning`

Lead creates `backlog/docs/tickets/t-###/coordination-log.md` and updates the task `references`.

### Step 2 — Product Manager (`feature` and `bug` only)
Lead spawns the PM with the ticket ID. PM:
1. Reads the ticket and focused product context.
2. Asks proactive product questions needed to eliminate ambiguity.
3. Drafts `backlog/docs/tickets/t-###/spec.md` from the backlog template.
4. Updates task references and Acceptance Criteria.

Lead appends to the coordination log and advances status → `Visual Design`.

### Step 3 — UX Designer (`feature` and `bug` only)
Lead spawns the UXD with the ticket ID. UXD:
1. Reads the ticket and current `spec.md`.
2. Asks proactive UX questions to surface UI, interaction, responsive, accessibility, branding, motion, sound, and reference-artifact details that are still implicit.
3. Refines the same `backlog/docs/tickets/t-###/spec.md` until the intended user experience is explicit enough for implementation planning.
4. Updates task references if new screenshots or other artifacts were added.

Lead appends to the coordination log and advances status → `Eng Planning`.

### Step 4 — Architect (all tickets)
Lead spawns the Architect with the ticket ID. Architect:
1. Reads the ticket, `spec.md` if present, testing strategy references, and one `plan.yaml` example only if multi-stream planning is relevant.
2. Evaluates approach: at least 2 options with tradeoffs for non-trivial work; one clear approach with rationale for straightforward bugs or improvements.
3. Asks every remaining engineering or constraint question needed to make the ticket autonomous.
4. Consults Tester once in `plan-review` mode; saves the result as `backlog/docs/tickets/t-###/test-plan.md`.
5. Drafts `backlog/docs/tickets/t-###/eng-plan.md` from the backlog template, including any automation hooks needed to prove UX goals before manual inspection.
6. Creates subtasks via `task create`, sets `depends_on`, and sets the WIP limit.
7. Updates parent references plus browser-visible Implementation Plan and Definition of Done in one task update.

Lead appends to the coordination log and advances status → `Ready for execution`.

### Step 5 — Eng Implementation
Lead picks up a `Ready for execution` ticket, establishes the ticket's dedicated execution worktree, and sets status → `In Progress`, along with the parent task `branch` and `worktree` fields. The parent `worktree` field is the canonical execution worktree for the ticket, not just a convenience note.

Follow `docs/ai/PR_WORKFLOW.md`: use one canonical feature branch and PR, open a draft after the first reviewable push, and record its URL in the parent ticket. Keep semantically coherent commits and subsequent fixes in that PR. A separate shared prerequisite requires the independently useful, testable, cross-feature justification defined there.

Lead fans out unblocked subtasks to Eng teammates. Each Eng:
1. Reads the subtask plus relevant eng-plan and test-plan context.
2. Sets subtask status → `In Progress`.
3. Implements only the assigned scope in an isolated worktree and branch dedicated to this ticket; reports commits to Lead without opening a subtask PR.
4. Runs the subtask acceptance checks.
5. Consults Tester only for novel gaps not already covered in `test-plan.md`.
6. Reports completion in the shared report shape and marks the subtask complete only after acceptance checks pass.

Lead monitors progress, integrates worker commits into the canonical feature branch in dependency order, reruns required checks after integration, and records decisions in the coordination log. These internal integrations do not merge the feature to main.

### Step 6 — Review
Once all subtasks are done, Lead sets status → `Review` and writes Implementation Notes.

Lead then does two things concurrently:
- refreshes the existing draft feature PR with the combined implementation and validation scope
- spawns Tester in `final-validation` mode

Tester treats `test-plan.md` as the floor, then hunts for seam failures, UX regressions, branding drift, accessibility misses, sound misuse, state drift, multi-client edge cases, and subtle merge issues.

If material issues are found, Lead creates follow-up subtasks, keeps their fixes in the same PR and loops back to Step 5. Otherwise, Lead waits for green CI and required validation before marking the PR ready for review, then advances the ticket to `Ready for acceptance`, writes Final Summary, and clears or intentionally retains the parent `branch` and `worktree` fields. Outstanding product gates remain explicit.

## Merge Gates and Coordination

Follow the same merge-gate rules as `ORCHESTRATION_WORKFLOW.md`:
- All subtask acceptance checks pass before merge.
- Dependencies merge in topological order.
- Lead owns cross-worktree conflict resolution.
- Merge decisions and conflict resolutions are recorded in `coordination-log.md`.
- Squash feature PRs by default; rebase only when explicitly chosen. Revalidate dependent features against the actual merged prerequisite, including squash/rebase effects. All existing merge authorization requirements remain in force.

## Testing Policy

All policies in AGENTS.md §4 apply within this workflow. Additionally:
- `test-plan.md` is produced once during Eng Planning and is the baseline for subtask implementation and final validation.
- Eng consults Tester only for novel gaps not already covered.
- Final validation is a fresh skeptical pass rather than a checklist re-run.
- When the ticket touches UX, final validation explicitly checks responsive placement, motion polish, accessibility, visual-identity consistency, and sound behavior when present.
- For UX-sensitive tickets, Tester uses `docs/ai/UX_VALIDATION_WORKFLOW.md` to convert UX goals into explicit automated proof lanes before implementation starts.

## Sprint Flows

### Planning Sprint

A planning sprint drives tickets from `To Do`, `Spec`, `Visual Design`, or `Eng Planning` to `Ready for execution`. It does not touch implementation.

**Invocation**:
- `Ps`
- `Ps [type]`
- `Ps [milestone]`
- `Ps [type] in [milestone]`

Where:
- `[type]` may be `feature`, `features`, `bug`, `bugs`, `improvement`, or `improvements`.
- `[milestone]` is a backlog milestone name such as `Friend play alpha`.
- Milestone names should be matched case-insensitively from the backlog, so natural invocations like `Ps friend play alpha` are valid.
- If both are provided, milestone filtering happens first and type filtering applies within that milestone.
- If milestone is omitted, the sprint considers all matching tickets across the backlog.

**Process**:
1. Lead lists all tickets that match the requested sprint scope and are not yet `Ready for execution`, sorted by priority.
   - If a milestone was specified, include only tickets assigned to that backlog milestone.
   - If a type was specified, include only tickets of that type within the selected milestone or global scope.
2. Lead runs the sprint as a pipeline, not a full-ticket serial loop:
   - `feature` and `bug`: Assignment → PM → UXD → Architect
   - `improvement`: Assignment → Architect
3. Within a single ticket, stage order remains gated: UXD does not start until PM is complete for that ticket, and Architect does not start until UXD is complete for that ticket.
4. Across the sprint, once one role finishes a ticket and hands it off, that role immediately starts the next highest-priority ticket that is ready for that role. Example: when PM finishes Ticket A and hands it to UXD, PM starts Ticket B while UXD works Ticket A.
5. Before the first stage starts on a ticket, output:
   `Sprint progress: [N/Total] — starting <ticket title> (t-###)`
6. Skip only stages that are already complete, and feed partially completed tickets into the earliest incomplete stage so they join the same pipeline.
7. PM, UXD, and Architect must each ask comprehensive, non-redundant questions that pull implicit intent into explicit docs.
8. After Architect completes a ticket, Lead advances that ticket to `Ready for execution` immediately, even while earlier-stage work continues on other tickets.
9. After the last ticket completes, output:
   `Sprint complete: N tickets advanced to Ready for execution`

### Execution Sprint

An execution sprint drives tickets from `Ready for execution` to `Ready for acceptance`. It does not touch spec, visual design, or eng planning.

**Invocation**:
- `Es`
- `Es [type]`
- `Es [milestone]`
- `Es [type] in [milestone]`

Where:
- `[type]` may be `feature`, `features`, `bug`, `bugs`, `improvement`, or `improvements`.
- `[milestone]` is a backlog milestone name such as `Friend play alpha`.
- Milestone names should be matched case-insensitively from the backlog.
- If both are provided, milestone filtering happens first and type filtering applies within that milestone.
- If milestone is omitted, the sprint considers all `Ready for execution` tickets across the backlog.

**Process**:
1. Lead lists all `Ready for execution` tickets that match the requested sprint scope, sorted by priority.
   - If a milestone was specified, include only tickets assigned to that backlog milestone.
   - If a type was specified, include only tickets of that type within the selected milestone or global scope.
2. Lead may run up to 3 top-level tickets in parallel during the sprint. Each active ticket must have its own dedicated execution worktree before implementation begins.
3. Lead fills open execution slots in priority order. When one active ticket reaches `Ready for acceptance`, Lead may start the next highest-priority `Ready for execution` ticket.
4. For each ticket that starts, Lead confirms that a dedicated execution worktree exists for that ticket, then runs Steps 5 and 6 of the ticket workflow.
5. Before starting each ticket, output:
   `Sprint progress: [N/Total] — starting <ticket title> (t-###)`
6. Within each active ticket, Lead fans out Eng subtasks, monitors progress, resolves conflicts, maintains the canonical feature PR, runs final validation, and waits for green CI.
7. After the last ticket completes, output:
   `Sprint complete: N tickets advanced to Ready for acceptance`

## Connections to Other Workflows

- Architect's `eng-plan.md` feeds `plan.yaml` plus stream briefs when multi-stream execution is warranted.
- Tester's UX proof planning extends `UX_VALIDATION_WORKFLOW.md` for automation-first UX enforcement.
- Tester's work extends `FRAGILITY_HARDENING_WORKFLOW.md`.
- Backlog CLI usage stays rooted in `./scripts/backlog.sh`; see AGENTS.md §7 for the full protocol.
- Shared canon remains in `docs/ai/ticket-workflow/`; Claude and Codex wrappers should stay thin and point back to that canon.
