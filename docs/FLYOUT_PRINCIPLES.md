# Flyout Principles

This document defines shared design and layout principles for `flyouts` in the Righelt web app.

A `flyout` is a secondary surface that breaks out of the normal page flow while remaining visibly tied to the current screen and context. Flyouts are not standalone pages and are not part of the main content stack.

## Core Principles

### 1. Separate Surface

- A flyout is a separate UI surface, not another panel in the main page flow.
- It should visually read as an adjacent layer that opens alongside the current page, not underneath or inline with the page content.
- The page should remain visible while the flyout is open.

### 2. Main Content Remains Primary

- The original page content remains the primary surface.
- Opening a flyout should not replace the page or turn the flyout into the new main layout region.
- The page should continue to own primary navigation, board content, history, and other core interactions unless a feature explicitly requires otherwise.

### 3. Content Shifts To Make Room

- When a flyout is open on wide screens, the rest of the page content, including the header, should shift to make room for it.
- That shift should be calculated against the space actually available to the main content after the flyout claims its width.
- The remaining main-content region should be horizontally centered within the non-flyout space rather than pinned to the left edge.

### 4. Dock To The Screen Edge

- On wide screens, a right-side flyout should dock to the viewport edge.
- The flyout should extend flush to the top, right, and bottom edges of the screen unless a feature explicitly requires a different treatment.
- A docked flyout should not appear as a floating card with exterior gutters on those edges.

### 5. Responsive Placement

- On narrow screens, a flyout should switch to a bottom-origin treatment rather than a right-side dock.
- The narrow-screen variant may behave more like a bottom sheet, but it is still a flyout and should remain visually distinct from the main page content.
- Breakpoint decisions for the main page layout should use the width remaining for page content after the flyout is considered, not total viewport width.

### 6. Independent Scroll Region

- Flyouts must have their own scroll container.
- Main page scrolling and flyout scrolling should be independent.
- Long flyout content should not force the main page layout to grow in a way that breaks the page composition.

### 7. Shared Structure

- Flyouts should have a dedicated flyout header that names the mode or tool currently shown.
- The flyout body should use the same spacing rhythm as standard shell panels unless a feature has a strong reason to diverge.
- Flyout-specific sections may reuse standard panel styling internally, but the flyout itself should remain visually identifiable as a separate surface.

### 8. Square, Docked Edge Language

- Docked flyouts should avoid rounded outer edges that touch the viewport edge.
- Rounded corners may still appear on internal panels inside the flyout.
- The outer flyout container should match the geometry of a docked edge surface, not a floating card.

### 9. Persistent Open State Across In-App Navigation

- If a flyout is open, in-app navigation should keep it open unless the destination explicitly opts out.
- Open/closed state should be represented in route state when persistence across navigation is important.
- Users should not need to repeatedly reopen the same flyout while moving through related pages.

### 10. Reduced Motion Friendly

- Flyouts may slide in and out, but motion should be brief, purposeful, and disabled or simplified when reduced-motion preferences are enabled.
- Motion should reinforce the direction and dock point of the flyout, not distract from the page.

## Implementation Guidance

- Treat flyout width as reserved layout space on wide screens.
- Keep flyout width bounded by a max width so it does not over-compress main content.
- Reserve flyout space before deciding whether the main content should use wide or narrow page layout.
- Prefer route-aware helpers and shared layout utilities over per-feature one-off flyout math.

## Applies To

These principles should guide:

- the current shell debug flyout
- future scenario, inspection, and diagnostics flyouts
- any future docked side or bottom contextual surfaces that are not full pages or blocking modals
