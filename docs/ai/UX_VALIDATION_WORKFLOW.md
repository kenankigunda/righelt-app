# UX Validation Workflow

This workflow defines how to turn UX goals into automated proof before implementation ships. Use it when a ticket touches UI, interaction, motion, accessibility, branding, layout stability, responsive behavior, or sound.

## Objective

The goal is to make manual UX review confirmatory rather than discovery-driven by proving, as early as possible, that the implemented UX matches the intended UX.

## Proof Lanes

Choose the smallest complete set of proof lanes needed for the ticket:

### 1. Semantic Proof
- Accessible names, roles, descriptions, and focus behavior.
- ARIA snapshots for broad structural checks.
- Scoped accessibility scans for automatically detectable violations.

### 2. Geometry Proof
- Bounding-box or viewport assertions for placement.
- Responsive wide and narrow placement checks.
- Overlay vs inline vs reserved-zone assertions.
- CSS state assertions only when those states are user-visible and meaningful.

### 3. Visual Proof
- Targeted screenshot comparisons for stable scenes only.
- Use deterministic fixtures, masking, or style overrides to reduce noise.
- Do not use blanket page snapshots as the default proof mechanism.

### 4. Stability And Responsiveness Proof
- Layout-shift proof during appearance, replacement, dismissal, and route transitions.
- Reduced-motion behavior proof.
- Interaction timing or user-timing proof when smoothness is part of the UX goal.
- Web Vitals or Lighthouse are secondary guardrails, not the primary proof for most tickets.

### 5. Behavioral Proof
- Integration and E2E assertions that the workflow, sequencing, copy, recovery behavior, and replacement rules match the spec.

## Planning Standard

Before implementation starts, UX-sensitive tickets should make these items explicit enough to automate:
- named placement zones
- viewport-specific behavior
- required accessible names, roles, and focus expectations
- motion and reduced-motion behavior in observable terms
- sound event categories, mute behavior, and non-required semantics
- deterministic fixtures or hooks needed to prove the intended behavior

If the current spec or eng plan cannot support automation of a UX goal, Tester should flag that gap during planning instead of waiting until final validation.

## Recommended Automation Patterns

- Prefer Playwright user-visible assertions first.
- Add ARIA snapshot checks where structural semantics matter.
- Add scoped accessibility scans for relevant surfaces rather than only whole-page scans.
- Use screenshot baselines only for curated scenes that are stable enough to trust.
- Use geometry assertions when the correctness claim is about placement, overlap, visibility, or responsive repositioning.
- Use integration tests for state permutations, event mapping, motion toggles, and sound selection logic.
- Use E2E for representative user-visible proof, not exhaustive matrix coverage.

## UX Proof Matrix

For UI-touching tickets, `test-plan.md` should include a `UX Proof Matrix` with:
- `Requirement or principle`
- `Expected behavior`
- `Primary proof lane`
- `Automated assertion shape`
- `Fixture / hook needed`

## Final Validation Standard

Final validation should report:
- which UX goals were proven automatically
- which proof lane(s) were used
- whether semantics, placement, responsiveness, stability, and sound behavior matched the spec
- any remaining risks that still need human judgment

## Sound Validation Guidance

- Sound is optional enhancement, never the only proof of state.
- Integration should verify sound event selection, mute behavior, and non-required semantics.
- E2E should only smoke-test high-value sound-trigger paths when they materially improve confidence.

## References
- [docs/TESTING_STRATEGY.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/TESTING_STRATEGY.md)
- [docs/ai/FRAGILITY_HARDENING_WORKFLOW.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/ai/FRAGILITY_HARDENING_WORKFLOW.md)
- [docs/UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md](/Users/kenankigunda/.codex/worktrees/5b34/righelt/docs/UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md)
