# UX Validation Workflow

The [marble and glass refresh](MATERIAL_UX_CONTRACT.md) requires independent UX-validator, product-tester and performance planner/tester loops during planning and implementation. Recheck repaired findings and preserve current and incoming approved workflows. Visual acceptance does not substitute for regression evidence.

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
- [Testing strategy](TESTING_STRATEGY.md)
- [Fragility review](FRAGILITY_HARDENING_WORKFLOW.md)
- [UX principles](../UX_PRINCIPLES.md)

## Validation evidence and PR shepherding

Follow [AGENTS validation guidance](../../AGENTS.md#validation-evidence-and-pr-shepherding) and the installed, pinned sibling `righelt-validation-tools/skills/validate-and-shepherd/SKILL.md`. Use an explicit candidate. The released policy owns execution, evidence reuse, publication and readiness gates. Do not substitute candidate-local tooling or copy a conflicting workflow here. Publication is currently paused until explicitly resumed. Deliver local evidence while preserving merge and activation gates.


## Studies and implementation acceptance

Compare alternatives inside the real component and surrounding page, using its actual assets, typography, source renderer and representative acknowledged records. Label synthetic layout fixtures and unmerged incoming states. A selected variant, recommendation, rendered preview and explicit approval are different facts. Record the final approval and later corrections before changing a normative contract. Preserve rejected alternatives as evidence without keeping their rules active. See [the decision index](../UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

For changed interactive surfaces, acceptance includes desktop and 320/390px mobile, breakpoint edges, short/landscape viewports, loaded/fallback/cold fonts, long names and natural 200% text or browser zoom as applicable. Test text enlargement and browser zoom separately when either can change layout. Measure 44px targets, native edge hit tests, nonoverlap, keyboard Enter/Space, focus identity, press continuity, reduced motion, scrolling, loading/error and wrapped states. Inspect source and target roles in grayscale/forced colors when meaning depends on styling. Preserve usable board-cell floors rather than shrinking controls to force fit.

Retain actual DOM references across semantically unchanged refreshes. Verify first input exactly once, including a background update during a native press, held worker/journal/receipt boundaries and negative authority cases. Measure input, projection, durable admission, acknowledgement and visible presentation separately when claiming latency. An unchanged timestamp or matching text is not complete identity or responsiveness proof.

Study QA establishes only its stated scope. It does not prove full-page geometry, real authentication, authoritative game creation, all-browser behavior, physical devices or deployment. Product acceptance needs the relevant contract assertions and exact candidate evidence. Preserve failures and raw originals. Independent review should cover the bounded coherent diff and changed findings, with unresolved gaps disclosed. Resource and final delivery procedures remain in [resource management](RESOURCE_MANAGEMENT.md), [PR workflow](PR_WORKFLOW.md) and the released validation skill. No schedule, email or publication action follows from this guidance.

For the marble refresh, enforce both [selected-reference fidelity and product fidelity](MATERIAL_UX_CONTRACT.md#unite-reference-fidelity-and-product-fidelity). Require per-property dispositions and independent UX/product repair rechecks. A polished simplified mock or a functionally correct visual undershoot cannot pass.

The marble refresh adds the independent [performance planner/tester lane](UI_PERFORMANCE.md) alongside UX and product review. It requires source-backed planning, bounded preexisting UI improvements, matched real-clock native workloads and measured budgets, then tester→repair→recheck at foundation/propagation/final integration. Existing observational fixture timing is not full-app performance acceptance.
