# First-pass UX feedback audit

October 6, 2026. Canonical PR: #120. This records the latest decision where earlier experiments conflict. Behavioral acceptance still requires the current combined test report and CI.

| Feedback family | Current implementation and regression evidence |
|---|---|
| Preserve existing principles and guest play | Original board geometry and desktop/touch rules retained. Guest and account browser suites run separately. Login #112 is already merged. |
| Brand and visual system | Selected logo retained; Manrope; shared cut-stone surfaces, four clipped corners, bevels, restrained depth, affiliation-aware actions and recognizable branded icons. |
| Background grid | Logo-aligned grid, stronger top-left and bottom-right, quieter but present center. Static treatment approved October 7 to avoid measured multi-page WebKit rendering delays, superseding slow subtle motion. |
| Home structure | Continue playing → Start → Other games, no empty Continue playing, natural scrolling, aligned cards, reserved metadata and existing pagination. Latest requested copy retained. |
| Fixed surroundings during reload | Cached cards and actual heading nodes survive pagination/loading. Open flyouts persist while routes change underneath. Browser tests retain DOM references. |
| Sections and Players hierarchy | Shared title weight and balanced insets. Emblem/name/presence form one group apart from seat label. Grey empty-state icons, no prohibition slash, compact presence, display name before username, inline profile details. |
| Invitations | Combined Players and invite actions. Seat-colored player invite, purple viewer invite, pending invite indicator, Play both players last. Top invitation surface, aligned explanatory text, inline copy feedback. |
| Pending approval and preview | One foreground pending status. Preview board loads but is strongly subdued and inert. Approval opens game. No duplicate joining or misleading watch-while-waiting copy. |
| Overlay behavior | Shared viewport positioning, background scroll lock/restoration, preventScroll focus, outside-click dismissal except strict gates, one inset scroll viewport, persistent lightweight close control. |
| Overlay content sizing | Width-led large scene, reachable content at zoom/short heights, scrollbars clear of clipped corners. No decorative overflow or bottom-action clipping. |
| Flyouts and Account | Attached edge owns entry/exit direction across breakpoints. Account settings use branded flyout/fullscreen phone treatment. Sign-in and creation remain modal. |
| Opponent stories | Three fixed stories, three scenes each, 3-second cycle, no hover pause, deliberate caret/keyboard stops cycling, reduced-motion manual control. Storybook turn direction corrected. |
| First/reopened introductions | First visit remains explicit even when ready. Close creates no game. Computer-player entry reopens story without pausing match. Unavailable trained play remains disabled. |
| Friend introduction | Original hands on Start, hands-only expanded tabletop invitation in overlay, one scene and explicit Start. No full human figures or animals. |
| Artwork | Large integrated scenes, crisp boundaries, continuous card surface, no fuzzy fades. Babs room continuity restored. Righelt piece vocabulary and corner-only supply arches. Source provenance lives beside assets. |
| Board surroundings | Thin top/bottom paired corner accents, only Board colored on game page, active color top/opponent bottom. Coordinate spacing corrected; quiet hover washes. |
| Legend | Commander over command line, supply point over supply line, group strength to right. Selected/active ownership color, only actually visible paths/badges, readable dash patterns, smooth interrupted resizing. |
| Commander windows | Opaque square-colored window masks lines/dots, including ghosts, while shared stack order preserves pushed underlays. Browser regressions cover both cases. |
| Sound intent | Hover/focus-only actions silent. Deliberate selection/preview/cancel/move/capture/turn, history and paging have distinct cues. No rerender/ack duplication. |
| Motion and sound | Paired entry/exit for overlays/flyouts, reversed history/page cues, quiet two-phase route swoosh follows cover/reveal easing with silent hold. Friend/self-play use same navigation. |
| Background sound | Hidden ordinary actions silent. Genuine incoming opponent move reminders repeat every 30 seconds until refocus. Mute/navigation/account retirement cancel them. |
| Confirmed outcomes | Immediate tactile move feedback does not imply confirmed victory. Confirmed terminal event emits result once, rejected optimistic result stays silent. |
| Sound consistency | Perceived loudness balanced to wooden cues, explicit mute preserved, browser restrictions respected, sources end/disconnect. Current rules consolidated in UX principles. |
| Results, rematch and tutorial | Results/rematch retain deliberate opponent/side choice. Placeholder tutorial bypassed; real lesson T-009, hosted teaching T-117, later board refinement T-118. |
| Regression structure | Shared component defaults plus unit/integration tests and full browser workflows enforce these contracts. No screenshot-only readiness claims. |

The independent review cleared the commander, sound confirmation, focus restoration, pending gate and pagination repairs. Its documentation contradictions were reconciled in `UX_PRINCIPLES.md`. Artwork inspection and the final combined report remain separate evidence.

## Explicit limits

The trained computer runtime is owned by its separate thread. Its unavailable state is not gameplay proof. Physical iPhone 13 mini / iOS 26.6.2 cellular performance remains unverified here. Publication and production account activation remain paused/separate. Later visual refinements belong to followup passes, not undocumented changes to these first-pass contracts.
