# Ticket Workflow

This document captures the non-default workflow for ticket-driven development using agent teams. Use it when kicking off a ticket from the backlog through spec → architecture → implementation → validation.

## When To Use It

Use this workflow for any ticket in `backlog/tasks/` that has been assigned to a Lead. Invoke with `Tk t-###` (or a step-specific shorthand) from AGENTS.md §6.1.

## Skills Contract

- Re-mention required skills in each turn where they should apply.
- Role definitions live in `.claude/agents/` (authoritative) and `docs/ai/teams/` (reference mirror).
- Call `get_backlog_instructions()` before any backlog MCP tool operations.
- If a referenced skill or role file is missing: state the issue briefly, fall back to AGENTS.md defaults, avoid blocking unless strictly required.

## Ticket Types and Routing

| Label | PO Step | Architect Step |
|---|---|---|
| `feature` | Full spec | Full approach evaluation (≥2 options if non-trivial) |
| `bug` | Lightweight spec (§1, §3, §4, §8 only) unless novel UX introduced | Approach usually clear; state rationale if so |
| `improvement` | **Skipped** — Architect reads ticket description directly | Approach usually clear; state rationale if so |

## Backlog Status Lifecycle

`To Do` → `Spec` → `Planning` → `In Progress` → `Review` → `Done`

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
7. Calls `task_edit` to update `references` and Implementation Plan section

Lead appends to coordination-log.md. Calls `task_edit` status → `In Progress`.

### Step 4 — Eng (implementation)
Lead fans out unblocked subtasks (respecting `depends_on` and WIP limit) to `eng` agents. Each Eng:
1. Calls `task_view` on its subtask; reads relevant `test-plan.md` rows
2. Calls `task_edit` subtask status → `In Progress`
3. Implements in isolated worktree/branch; commits scoped by acceptance criterion (AGENTS.md §5)
4. Runs acceptance checks; calls `task_complete` on subtask when passing — no Tester re-spawn for covered cases
5. Consults Tester via `Agent` tool only for novel gaps not in test-plan.md
6. Flags issues needing new subtasks to Lead before marking done
7. Reports: `Progress / Validation (commands + results) / Blockers / Next`

Lead reads coordination-log.md each cycle; calls `task_list parent=t-###` to check subtask state; resolves merge conflicts; re-runs acceptance checks after merges.

### Step 5 — Final Validation
Once all subtasks are `Done`, Lead calls `task_edit` status → `Review`. Spawns `tester` agent for a **fresh skeptical pass** — not a checklist re-run. Tester approaches the full changeset as if seeing it for the first time: `test-plan.md` is the floor, but Tester actively hunts seam failures, state drift, multi-client edge cases, and subtle regressions that per-subtask gates may have missed. Tester reports pass/fail per item, new failure modes, remaining risks. Lead: if material issues, creates new subtasks and loops to Step 4; otherwise calls `task_complete` on the parent ticket. Appends final summary to coordination-log.md.

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

## Connections to Other Workflows

- Architect's `eng-plan.md` feeds `plan.yaml` + stream briefs when multi-stream execution is warranted (`ORCHESTRATION_WORKFLOW.md`)
- Tester's work extends `FRAGILITY_HARDENING_WORKFLOW.md` — Tester uses that workflow as part of its toolkit
- Backlog MCP: see `backlog://workflow/overview` or call `get_backlog_instructions()` for the full Backlog.md usage protocol
