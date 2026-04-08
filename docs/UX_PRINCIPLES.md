# Righelt UX Principles

This document defines the shared UX canon for the Righelt web app shell. It covers information architecture, visual identity, motion, feedback, sound, accessibility, and the overall quality bar for a slick, modern, non-generic experience.

Righelt should feel clean and easy to play at a glance, but also distinct. The goal is not "generic modern app" polish. The goal is a recognizable shell with its own calm personality, built around the game's player colors, strong layout rhythm, stable feedback, and a clear sense of responsiveness.

External references that informed these principles include Apple Human Interface Guidelines, Material responsive-layout guidance, Atlassian message design guidance, Carbon notification accessibility guidance, and the general product qualities seen in clean online game surfaces such as NYT Games. These are inputs, not a brand template to copy.

## Core Experience Goals

- Make primary play and decision-making feel immediate, legible, and low-friction.
- Keep the shell visually calm, never crowded, jumpy, or overly ornamental.
- Use polish to increase confidence and delight, not to show off animation or effects.
- Preserve a distinctive Righelt personality so the product does not feel like default framework chrome.
- Maintain accessibility as a first-class requirement, not a cleanup pass.
- Favor clarity that feels confident and playful over enterprise-heavy density.
- Make repeated use feel pleasant: interactions should feel composed, readable, and quietly rewarding over many sessions.
- Build recognition through consistency so players can tell they are in Righelt from color, spacing, feedback, and shell tone alone.

## Core Information Architecture Principle

- Equivalent pieces of information should occupy equivalent vertical positions across sibling surfaces.
- When one card or row omits optional supporting content, preserve the baseline of the remaining shared content rather than letting the stack collapse.
- This keeps scan patterns stable and prevents role, status, or timestamp lines from visually "jumping" between adjacent cards.

## Game Card Rule

- In home page game cards, the primary role line must appear at the same height whether the player controls one seat or both seats.
- Removing optional supporting copy, such as local self-connection text, must not change the vertical placement of the role line relative to neighboring cards.
- When necessary, reserve the missing row with hidden placeholder space instead of introducing visible filler copy.

## Future UI Guidance

- Apply this rule anywhere we present repeated metadata stacks, including future game cards, summaries, flyouts, and side-by-side status surfaces.
- Treat stable row ordering and stable row height as part of the product's information architecture, not just a visual polish detail.
- If a design change removes one row from only some siblings, explicitly decide whether a placeholder or other layout reservation is needed to preserve alignment.

## Hierarchy and Playability Principle

- The most important action or piece of information on a screen should be immediately obvious without scanning the entire page.
- Favor one clear primary action or decision area per view state. Secondary actions should be visually subordinate.
- Game-state comprehension beats decorative density. Any added styling must preserve quick understanding of whose turn it is, what changed, and what the player can do next.
- Prefer concise, high-signal UI copy over verbose helper text. When extra explanation is needed, stage it behind the primary path instead of forcing it into the main flow.

## Vertical Rhythm Principle

- Within a repeated UI record, vertical spacing should be owned by the parent stack rather than by individual child rows.
- Titles, metadata, sub-records, and actions inside the same record should sit on one shared vertical rhythm unless the design explicitly calls for a section break.
- Optional rows must join the same spacing rhythm as always-present rows instead of adding one-off top or bottom margins.
- State changes such as selected, expanded, undone, annotated, or pending should preserve the baseline spacing rhythm unless the state is intentionally introducing a new visual grouping.

## Section Break Rhythm Principle

- Use spacing to express hierarchy with the Gestalt proximity rule: items that belong to the same conceptual section should sit closer together than items that belong to adjacent sections.
- In repeated records, use at least three intentional rhythm levels when needed:
  - within-section spacing for tightly related rows
  - between-section spacing for distinct clusters inside one record
  - between-record spacing for sibling records in the list
- Keep these levels ordered consistently so `within-section < between-section < between-record`, unless a deliberate visual interruption calls for something stronger.
- Section breaks should be container-owned, usually by wrapping each section and letting the parent record define the gap between sections, rather than by stacking ad hoc child margins.
- When reviewing a UI iteration, compare the section-break gap not only against the rows around it, but also against the existing distance between sibling records so the list hierarchy still scans cleanly.

## Horizontal Rhythm Principle

- Within a repeated UI row or cluster, horizontal spacing should be owned by the parent layout rather than by ad hoc child offsets.
- Bullets, icons, labels, metadata chips, and action affordances that belong to the same rhythm should align to shared gutters and column starts.
- Optional leading or trailing elements must not cause sibling content to drift horizontally unless the design explicitly calls for a different hierarchy.
- When a repeated surface mixes primary and secondary content, use stable indentation and stable gutters so scan paths remain consistent across siblings and states.

## Adaptive Layout Principle

- Responsive behavior should not be treated as simple shrinkage. As viewport size changes, components may reposition to more appropriate zones when that improves comprehension or focus.
- Wide and narrow layouts should each feel intentionally designed. The narrow version is not a compromised afterthought.
- When a surface changes position across breakpoints, the spec should name both placements explicitly.
- Use overlay, reserved-zone, inline, and blocking patterns intentionally:
  - reserved zone when feedback should stay present without disturbing surrounding layout
  - overlay when feedback should sit above content without consuming layout space
  - inline when feedback belongs directly to a nearby form or record
  - blocking surface when the player must act before continuing
- If a UI element changes from inline to overlay or from one region to another across breakpoints, define that behavior in the spec rather than leaving it implicit.

## Spacing Ownership Rule

- Prefer container-managed `gap`, padding, grid tracks, or flex spacing as the default source of layout rhythm.
- Avoid stacking child-specific margins on top of container spacing inside repeated records, because those local adjustments tend to drift apart as optional content and stateful controls are added.
- If a child needs an exception, treat it as an explicit hierarchy break and document why it should not follow the shared rhythm.
- During review, check whether spacing is being defined once at the container level or being recreated piecemeal by descendants.

## Layout Stability Principle

- Transient feedback must not cause avoidable layout snapping, shell reflow, or perceptual "jumping" of core play surfaces.
- Alerts, banners, confirmations, and live-status updates should appear in surfaces designed to absorb them gracefully.
- Replacement and dismissal transitions should feel composed, not like content abruptly collapsing out from under the user.
- When a state change could affect layout, prefer shell-owned regions or overlays over injecting content into fragile interior stacks.

## Repeated Record Grouping Rule

- When a record mixes informational content and controls, treat those as separate sections even when they appear inside the same card or list row.
- Keep the internal rhythm of the informational stack and the controls stack consistent within themselves, then use a slightly larger section break to show the conceptual handoff from "what this is" to "what you can do here."
- Do not let action controls float on the same spacing cadence as descriptive metadata unless the controls are intentionally being presented as peer content rather than follow-up actions.
- Apply the same grouping logic across cards, side panels, flyouts, and inspector rows so interaction affordances feel predictably attached to the content they act on.

## Mobile Screen Real Estate Principle

- On narrow mobile layouts, shared shell routes should use the smallest safe outer gutters that preserve readability and tap comfort.
- The home page should follow the same screen-real-estate maximization rule as the game page instead of reserving extra horizontal chrome by default.
- When we tighten mobile gutters for one primary shell route, treat that as a shared shell principle and document whether sibling routes should inherit it.

## Feedback Surface Principle

- Feedback placement must match urgency and required action.
- Use lightweight, non-blocking surfaces for confirmations and informational updates.
- Use stronger, more persistent treatment when there is user risk, system degradation, or another participant is waiting on a decision.
- Notifications should have a stable and predictable home in each viewport mode.
- Interactive notifications must have clear focus behavior and dismissal rules. Non-interactive notifications should not steal focus.
- Do not use the same visual weight and placement for every message type. The shell should distinguish ambient updates, actionable requests, warnings, and blocking approvals.

## Hover Capability Principle

- Button and button-link hover styling must be gated by `data-hover-capability="hover"`.
- Treat hover styling as progressive enhancement only and do not make required behavior depend on hover availability.
- When adding new interactive hover affordances, verify that non-hover and touch devices preserve the same required behavior without hidden-only states.

## Motion Principle

- Motion should communicate causality, feedback, and state change without adding churn.
- Favor short, confident transitions over flashy flourishes.
- Pressed-state feedback should feel immediate. Release-state feedback should resolve as one short, coherent animation.
- Animations that change layout should protect readability while moving.
- Motion across related surfaces should feel synchronized when they are part of the same interaction.
- Respect `prefers-reduced-motion: reduce` by disabling non-essential animation and preserving comprehension without movement.

## Righelt Visual Identity

- Righelt's core brand colors are the player colors: `red`, `blue`, and `purple`.
- These colors should be reused intentionally across the shell so the product feels cohesive rather than arbitrarily themed page by page.
- Build supporting palettes around those core hues with calm neutrals and restrained complementary accents.
- Use those colors consistently enough to form memory, but not so aggressively that every surface feels saturated or competitive.
- Use color to reinforce identity and meaning, but never as the only carrier of meaning.
- Backgrounds, gradients, texture, and atmospheric effects should be subtle. They should make the page feel alive and pleasant without competing with gameplay.
- Prefer layered, low-contrast atmosphere over flat emptiness: faint gradients, soft depth, and restrained loading treatments are welcome when they support calmness and legibility.
- Loading states, chrome, shells, and notifications should feel like members of one family: consistent corner language, depth language, emphasis rules, and typography rhythm.
- Avoid default framework-looking surfaces. If a component looks like unmodified generic UI, treat that as a design smell and decide what makes it unmistakably Righelt.

## Modern Feel Principle

- "Modern" for Righelt means clean, fast, and intentional, not interchangeable.
- Prefer a small number of well-defined visual ideas repeated consistently over a grab bag of trendy effects.
- Polished surfaces should feel lightweight and game-friendly, similar in usability spirit to the clearest casual game products, while still expressing Righelt's own brand.
- Avoid bootstrap-like sameness: default cards, buttons, alerts, and forms should be treated as unfinished until they carry Righelt's own spacing, emphasis, and feedback language.
- Small pleasant details matter when they do not distract: subtle hover depth, composed loading shimmer, quiet background atmosphere, and confident transition timing can all contribute to a memorable shell.
- Personality should never come from noise. If an effect competes with turn-taking, move comprehension, or decision clarity, it is too much.

## Sound Principle

- Sound is optional enhancement, never a required channel for understanding app state.
- Use sound sparingly and only where it meaningfully improves clarity, responsiveness, or delight.
- High-value candidates include:
  - piece placement or commit confirmation
  - incoming move or turn handoff
  - incoming participant request or approval-needed state
- Different event categories should have distinct tones, but the palette should stay small and recognizable.
- The sound palette should feel deliberate and branded, not like a bag of unrelated stock effects.
- Sound must always be paired with visible feedback.
- Provide a clear path to mute or disable non-essential sound if sound is introduced.
- Avoid novelty sounds, repeated ambient loops, or dense sound layering that would make the shell feel noisy or gamey in a cheap way.

## Accessibility Principle

- Meet modern accessibility expectations by default: sufficient contrast, visible focus states, keyboard access, touch-safe targets, semantic announcements, and reduced-motion support.
- Do not rely on color alone to communicate meaning, role, status, or urgency.
- Interactive surfaces that require action must have clear focus order and keyboard behavior.
- Notification semantics should reflect whether the content is informational, status-only, or action-requiring.
- Visual polish must never compromise readability, contrast, or control discoverability.

## Spec and Planning Rule

- UI-touching feature and bug tickets must make the intended user experience explicit before Eng Planning begins.
- PM, UX Designer, and Architect should each ask proactive questions inside their domain to pull unspoken intent out of the human's head.
- The default path is text-first clarification: ask focused questions and turn the answers into explicit UX decisions before asking for any reference artifact.
- Do not ask the human to create new mocks for ticket planning.
- If the referenced UI surface is ambiguous, ask for a screenshot of the current product as a fallback so the exact existing surface can be identified.
- When screenshots or other reference artifacts are needed, attach them to the backlog repo.
- If the intended experience depends on viewport-specific placement, animation feel, branding treatment, or sound, those details belong in the ticket spec and eng plan, not only in chat.
