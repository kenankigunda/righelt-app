# Spec: t-### — [Type] Title

<!-- Sections §5–§7 are optional: include only what the ticket touches. -->
<!-- For lightweight bug specs: include only §1, §3, §4, §8 + a rationale note. -->

## 1. Customer Problem
<!-- What pain or friction does the player (or host) experience today?
     Describe from the player's perspective, not in system terms. -->

## 2. Affected Users & Contexts
<!-- Which player roles are affected: host, participant, observer, guest?
     In which game phase or shell state?
     lobby / in-game / history / tutorial / offline / reconnecting -->

## 3. Current Behavior
<!-- (bugs and improvements only)
     What happens today that is wrong, surprising, or suboptimal?
     Include multiplayer / multi-client edge cases if relevant. -->

## 4. Intended Behavior
<!-- Normative description of the desired state.
     Use "must", "shall", "is legal" language where behavior is definitive.
     Reference RIGHELT_WEB_APP_SPEC.md or RIGHELT_RULES_SPEC.md sections
     that already govern related behavior — do not restate what is already there. -->

## 5. Rules & Engine Contract
<!-- (if game logic is affected)
     Does this change how legal actions are determined, scored, or resolved?
     Call out any delta to RIGHELT_RULES_SPEC.md.
     Specify what the engine must expose and what the shell consumes. -->

## 6. Shell / Board Boundary
<!-- (if UI is affected)
     What does the shell own vs what is board-internal?
     Follow ownership boundary in RIGHELT_WEB_APP_SPEC.md §1.1.2.
     The shell must not branch on board internals. -->

## 7. UX Design

### 7.1 Information Architecture
<!-- How is information laid out? What is the hierarchy?
     Apply vertical alignment stability (UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md).
     No column jumping; preserve row height even when optional content is absent. -->

### 7.2 Motion & Transitions
<!-- What transitions occur? (expand/collapse, route change, state settle)
     Follow layout-stability conventions in RIGHELT_WEB_APP_SPEC.md §1.1.6.
     Specify timing intent if relevant. -->

### 7.3 Feedback & Affordances
<!-- How does the player know their action was received?
     What pressed/hover/disabled states exist?
     Progressive enhancement: no hover-only critical paths (data-hover-capability). -->

### 7.4 Multiplayer & Presence
<!-- Multi-client scenario: what does Player A see while Player B acts?
     Optimistic vs server-confirmed state handling.
     Presence indicators, sync propagation, reconnect/offline grace. -->

### 7.5 Mobile & Viewport
<!-- Any gutter, tap target, or layout concerns?
     Follow the mobile real-estate gutter principle. -->

## 8. Acceptance Criteria
<!-- Observable outcomes from the player's perspective.
     Each criterion independently testable.
     Map each to a spec section or rule where possible. -->
- [ ] AC1: ...
- [ ] AC2: ...

## 9. Out of Scope
<!-- Explicitly call out what this ticket does NOT address. -->

## 10. Open Questions & Decisions
<!-- Tradeoffs resolved during PO ↔ human discussion.
     Document the decision and rationale, not just the question. -->

## 11. References
<!-- RIGHELT_WEB_APP_SPEC.md §X, RIGHELT_RULES_SPEC.md §X,
     UI_INFORMATION_ARCHITECTURE_PRINCIPLES.md, WORKFLOW_COVERAGE.md -->
