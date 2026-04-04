# Ticket Workflow

This document captures the non-default workflow for ticket-driven development using agent teams. Use it when kicking off a ticket from the backlog through spec → architecture → implementation → validation.

## When To Use It

Use this workflow for any ticket in `backlog/tasks/` that has been assigned to a Lead. Invoke with `Tk t-###` (or a step-specific shorthand) from AGENTS.md §6.1.

## Skills Contract

- Re-mention required skills in each turn where they should apply.
- Role definitions live in `.claude/agents/` (authoritative).
- Call `get_backlog_instructions()` before any backlog MCP tool operations.
- If a referenced skill or role file is missing: state the issue briefly, fall back to AGENTS.md defaults, avoid blocking unless strictly required.

## Ticket Types and Routing

| Label | PO Step | Architect Step |
|---|---|---|
| `feature` | Full spec | Full approach evaluation (≥2 options if non-trivial) |
| `bug` | Lightweight spec (§1, §3, §4, §8 only) unless novel UX introduced | Approach usually clear; state rationale if so |
| `improvement` | **Skipped** — Architect reads ticket description directly | Approach usually clear; state rationale if so |

## Backlog Status Lifecycle

`To Do` → `Spec` → `Planning` → `Ready for execution` → `In Progress` → `Review` → `Ready for acceptance` → `Done`

- **Ready for execution**: spec and eng plan are complete; the ticket can be autonomously implemented without further human input.
- **Ready for acceptance**: all implementation, local validation, and CI have passed; a human must review and either accept (→ `Done`) or provide feedback for further work.

Only the Lead calls `task_edit` to advance status. All intermediate working state lives in `docs/tickets/t-###/coordination-log.md`.

## Document Structure Per Ticket

Rich documentation lives in `docs/tickets/t-###/` (mirroring the `docs/features/` pattern):
- `spec.md` — written by PO (features + some bugs)
- `eng-plan.md` — written by Architect
- `test-plan.md` — written by Tester (during Architect phase, saved once)
- `coordination-log.md` — maintained by Lead; single working-state document

The backlog task file (`backlog/tasks/t-### - Title.md`) links to these via the `references` field. Subtasks use IDs `t-###.01`, `t-###.02`, etc. with `parent_task_id: t-###`.

## Lead Execution Loop

### Step 0 — Ticket Creation
Human creates ticket via `task_create` MCP or `backlog task add` CLI: title, label (`feature`/`improvement`/`bug`), priority, brief description. Status: `To Do`.

### Step 1 — Assignment
Lead calls `task_view` to read label and route. Calls `task_edit`: set assignee, status → `Spec` (feature/bug) or `Planning` (improvement). Creates `docs/tickets/t-###/coordination-log.md`. Updates `references` field.

### Step 2 — Product Owner (feature and bug tickets only)
Lead spawns `product-owner` agent with the ticket ID. PO:
1. Calls `task_view`; reads focused reference docs per its role file
2. **Human checkpoint**: asks all questions needed to eliminate ambiguity (features: uncapped; bugs: only if behavior/scope is genuinely unclear)
3. Drafts `docs/tickets/t-###/spec.md` from `docs/tickets/SPEC_TEMPLATE.md`
   - Features: full spec
   - Bugs: lightweight (§1, §3, §4, §8) unless novel UX; includes rationale line
4. Calls `task_edit` to update `references` and Acceptance Criteria

Lead appends to coordination-log.md. Calls `task_edit` status → `Planning`.

### Step 3 — Architect (all tickets)
Lead spawns `architect` agent with the ticket ID. Architect:
1. Calls `task_view`; reads spec if present; reads `docs/TESTING_STRATEGY.md`, `docs/WORKFLOW_COVERAGE.md`, one existing `plan.yaml`
2. Evaluates approach: ≥2 options with tradeoffs for non-trivial features; one clear approach with rationale for bugs/improvements
3. **Human checkpoint**: asks all questions needed to resolve genuine tradeoffs (may skip if approach is unambiguous — last human-in-the-loop point before autonomous execution)
4. **Consults Tester once** via `Agent` tool: passes design → receives test plan → saves as `docs/tickets/t-###/test-plan.md`
5. Drafts `docs/tickets/t-###/eng-plan.md` from `docs/tickets/ENG_PLAN_TEMPLATE.md`
6. Creates subtasks via `task_create` with `parentTaskId: t-###`; sets `depends_on` and WIP limit
7. Calls `task_edit` on parent to add `eng-plan.md` and `test-plan.md` to `references`; populates **Implementation Plan** (3–5 bullet summary of approach + link to `eng-plan.md`) and **Definition of Done** (technical checklist from acceptance checks) — all in one call.

Lead appends to coordination-log.md. Calls `task_edit` status → `Ready for execution`.

### Step 4 — Eng (implementation)
Lead picks up a `Ready for execution` ticket and calls `task_edit` status → `In Progress`, then fans out unblocked subtasks (respecting `depends_on` and WIP limit) to `eng` agents. Each Eng:
1. Calls `task_view` on its subtask; reads relevant `test-plan.md` rows
2. Calls `task_edit` subtask status → `In Progress`
3. Implements in isolated worktree/branch; commits scoped by acceptance criterion (AGENTS.md §5)
4. Runs acceptance checks; calls `task_complete` on subtask when passing — no Tester re-spawn for covered cases
5. Consults Tester via `Agent` tool only for novel gaps not in test-plan.md
6. Flags issues needing new subtasks to Lead before marking done
7. Reports: `Progress / Validation (commands + results) / Blockers / Next`

Lead reads coordination-log.md each cycle; calls `task_list parent=t-###` to check subtask state; resolves merge conflicts; re-runs acceptance checks after merges.

### Step 5 — Review
Once all subtasks are `Done`: Lead calls `task_edit` status → `Review`, also populating **Implementation Notes** (brief aggregation of Eng report decisions and surprises from the cycle log) — merged into the same call.

**5a — Open PR**: Lead opens a pull request containing all changes for the ticket. The PR description follows the standard format (bullet points, Sentence case). The PR link is recorded in coordination-log.md.

**5b — Final Validation**: Lead spawns `tester` agent for a **fresh skeptical pass** — not a checklist re-run. Tester approaches the full changeset as if seeing it for the first time: `test-plan.md` is the floor, but Tester actively hunts seam failures, state drift, multi-client edge cases, and subtle regressions that per-subtask gates may have missed. Tester reports pass/fail per item, new failure modes, remaining risks. Lead: if material issues, creates new subtasks and loops to Step 4.

**5c — CI**: Lead monitors CI on the PR. If CI fails, Lead delegates to an `eng` teammate to diagnose and resolve the failure; the subtask follows the same Eng loop (Steps 4.3–4.6). Lead does not advance until CI is green.

**5d — Advance**: Once local validation passes AND CI is green, Lead calls `task_edit` status → `Ready for acceptance`, including a **Final Summary** (PR-style paragraph: what was built, what changed, what was deferred) — same content as the coordination-log.md final entry, routed to the task field as well. The ticket now awaits human acceptance. The human is responsible for either moving it to `Done` or providing feedback for further work.

## Merge Gates and Coordination

Follow the same merge-gate rules as `ORCHESTRATION_WORKFLOW.md`:
- All subtask acceptance checks pass before merge
- Dependencies merged in topological order
- Lead owns cross-worktree conflict resolution
- Record merge decisions and conflict resolutions in coordination-log.md

## Testing Policy

All policies in `AGENTS.md §4` apply within this workflow. Additionally:
- `test-plan.md` is produced once by Tester (during Architect phase) and is the reference for all Eng subtasks
- Eng teammates consult Tester only for novel gaps not already covered
- Final validation is a fresh skeptical pass, not a checklist re-run — it is the primary safety net for subtle correctness issues

## Git and Change Hygiene

All policies in `AGENTS.md §5` apply. Commits are scoped to the active subtask and its acceptance criteria. Worktree and branch conventions follow `ORCHESTRATION_WORKFLOW.md` when multi-stream execution is used.

## Sprint Flows

Sprint flows are adapted compositions of the ticket workflow that focus on a specific phase across multiple tickets in priority order.

### Planning Sprint

A planning sprint drives tickets from `To Do` / `Spec` / `Planning` to `Ready for execution`. It does not touch implementation.

**Invocation**: `Ps [type]` where `[type]` is a ticket label (e.g. `feature`, `bug`, `improvement`), yielding e.g. "feature planning sprint".

**Process**:
1. Lead calls `task_list` to collect all tickets of the given type that are NOT yet `Ready for execution`, sorted by priority.
2. For each ticket in priority order, Lead runs Steps 1–3 of the ticket workflow (Assignment → PO → Architect) as applicable:
   - Skip stages that are already complete (e.g. if spec already exists, skip PO step).
   - Human checkpoints in Steps 2 and 3 remain intact. The PO and Architect must ask comprehensive, non-redundant questions that elicit the clarity needed to make the ticket fully autonomous. They should think proactively about non-obvious implications — edge cases, integration points, scope boundaries, success criteria — and aim for breadth to build a holistic picture. The goal is that after the human answers, no further human input is needed to implement the ticket.
3. At the end of Step 3 for each ticket, Lead advances status to `Ready for execution`.
4. Lead continues to the next ticket without waiting for human re-approval between tickets unless a human checkpoint produces a blocking question.

**Successful outcome**: a prioritised set of `Ready for execution` tickets whose specs and eng plans succinctly and robustly describe the full scope of work needed, with no open questions.

### Execution Sprint

An execution sprint drives tickets from `Ready for execution` to `Ready for acceptance`. It does not touch spec or planning.

**Invocation**: `Es`

**Process**:
1. Lead calls `task_list` to collect all `Ready for execution` tickets, sorted by priority.
2. For each ticket in priority order, Lead runs Steps 4–5 of the ticket workflow (Eng implementation → Review):
   - Fans out Eng subtasks, monitors progress, resolves merge conflicts.
   - Opens the PR, runs final validation, monitors CI, resolves any CI failures via Eng delegation.
3. Once the ticket reaches `Ready for acceptance`, Lead moves to the next ticket.
4. Lead continues without waiting for human re-approval between tickets.

**Successful outcome**: all previously `Ready for execution` tickets are now `Ready for acceptance`, each with an open PR, passing local validation, and green CI, awaiting human sign-off.

## Connections to Other Workflows

- Architect's `eng-plan.md` feeds `plan.yaml` + stream briefs when multi-stream execution is warranted (`ORCHESTRATION_WORKFLOW.md`)
- Tester's work extends `FRAGILITY_HARDENING_WORKFLOW.md` — Tester uses that workflow as part of its toolkit
- Backlog MCP: see `backlog://workflow/overview` or call `get_backlog_instructions()` for the full Backlog.md usage protocol
