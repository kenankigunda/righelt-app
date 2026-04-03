# Fragility Hardening Workflow

This document captures the non-default workflow for tester-minded fragility hunting after a feature appears complete. Use it when the goal is not just to verify the primary change, but to think creatively about adjacent failures, stale state, race conditions, cache drift, contract erosion, and other ways the solution could break now or later.

## When To Use It

Use this workflow when the user asks for a deeper confidence pass such as:

- "What else could go wrong here?"
- "Think like a tester."
- "Harden this against regressions."
- "Find fragile spots and prove they work."

It is especially useful after architectural changes, payload contract splits, cache/store changes, optimistic UI updates, background synchronization work, or CPU/performance fixes that may shift behavior across boundaries.

## Objective

The goal is to increase confidence without relying on manual testing by:

- identifying plausible failure modes beyond the originally reported bug
- verifying those risks with targeted tests
- fixing any issues the tests expose
- documenting remaining risks or gaps that still need coverage

## Fragility Hunting Standard

For the relevant workflow, explicitly inspect these categories and adapt them to the feature:

- primary happy path still works end to end
- adjacent workflows still work
- stale cache or duplicated state can drift
- optimistic updates diverge from server-confirmed state
- websocket or background sync updates do not propagate correctly
- pagination, sorting, filtering, or sectioning become inconsistent after updates
- lightweight payloads silently grow or regain heavy fields
- detail views and summary cards drift from each other semantically or visually
- edge cases such as empty state, large payloads, dual-role users, guest users, or partially loaded state break
- debug-only behavior leaks into normal behavior or vice versa
- performance fixes preserve correctness under high-history or high-volume fixtures

## Execution Loop

1. Restate the core behavior that changed and the trust boundary it crosses.
2. List plausible failure modes, including creative and adjacent regressions.
3. Group the risks by test layer:
   - unit tests for mapping and isolated invariants
   - integration tests for subsystem and contract boundaries
   - E2E tests for workflow proof
4. Add or extend tests that would fail if each important risk were real.
5. Run the relevant test pass.
6. Fix any issues the tests expose.
7. Re-run the relevant test pass until green.
8. Report what was verified, what was fixed, and any remaining gaps.

## Test Design Rules

- Prefer tests that prove behavior at the boundary where it could regress.
- Use integration tests for variant depth and state permutations.
- Use E2E tests for workflow success proof rather than exhaustive matrix coverage.
- Add regression assertions for nearby workflows, not only the direct bug.
- Include at least one edge case or stress-style fixture when the change affects performance, payload size, or long-lived state.
- If a new abstraction or shared mapper was introduced, test each input source that feeds it.
- If the change split summary and detail models, verify both contracts and the transition between them.
- If the change added caching, verify cache freshness, cache invalidation, and cache independence from authoritative live state.

## Expected Output

When using this workflow, the result should include:

- the key failure modes considered
- the tests added or extended to cover them
- any defects discovered and fixed during the pass
- the commands run
- any remaining unverified risks or follow-up opportunities

## Repo Testing Policy Alignment

This workflow extends, and does not replace, the normal testing policy in `AGENTS.md`.

- Every behavioral change still needs unit and integration coverage unless it is purely non-functional.
- Every touched workflow must still consider whether E2E coverage should be added or expanded.
- The full relevant test pass remains a correctness gate before advancing the work.
