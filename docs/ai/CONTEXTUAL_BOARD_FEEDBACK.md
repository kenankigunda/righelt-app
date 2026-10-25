# Contextual board feedback

This follow-on builds on the opponent, invitation and history work in PR156. Its release must preserve the deployed game records and model provenance. Training may proceed from the reviewed immutable154 source and a frozen data cut before UI deployment, subject to an explicit resource window. Model promotion remains separate.

## Confirmed decisions

- Selected-piece and selected-move explanations belong in the board message, including inactivity, frozen sequence eligibility and blocked destinations. Floating labels describe events only.
- Destruction labels describe the cause: Lost supply or No retreat. Unknown or ambiguous legacy causes use Destroyed. Raw records and historical messages remain unchanged.
- Event labels wrap, flip and stay within the visible viewport. Nearby labels avoid overlap where space permits. They cannot take focus or intercept clicks. The existing removal lifecycle remains the only expiry clock.
- Frozen eligibility takes priority over current connectivity when explaining why a piece cannot move. Current loss of connectivity during an otherwise eligible sequence is described without falsely declaring the piece inactive or instructing an impossible move.
- Narrow boards fit all ten columns at320px, including enlarged text, without horizontal page overflow.
- Routine computer status appears only in the board message. Thinking remains the main search message. Checking and saving use the named player's phase text after500ms, skipping brief phases. Preparation has no elapsed timer.
- Recovery notices retain their existing delay and error thresholds. They have no progress bar or elapsed timer. Debug view contains elapsed phase and pending-save details. A retained pending journal entry must never conceal an immediate recovery error.
- Home cards use seat-colored You vs. DisplayName, falling back to username or Guest for joined opponents. Add compact presence beside the opponent; computers always show the connected mark with a Computer player description. Viewers see both colored names and dots, genuine owned self-play says You play both sides and vacant seats say Open seat.
- Players rows start with the colored emblem, without numbered seat labels. Your seats say You, opponents use display name, username fallback or Guest, and computers retain their name and a small Computer badge. Names stay neutral in this card. The Computer badge is confined to Players. Remove the standalone participant-name block under the History heading entirely; individual history entries retain computer names.
- Viewer summaries show No viewers when empty, otherwise up to two names, then N others and N guests. The current viewer appears as You in the first name slot. Expanding shows every profile with stable identity keys; duplicate display names remain separate people.
- Board and history captions use your perspective: Your turn to play or Opponent to play, and Waiting on you/opponent to move. Self-play uses You for both seats. Spectators see names or Guest, with Guest 1/Guest 2 when both seats are guests. Actual actor color also covers defender retreat decisions. Long spectator names truncate visually while retaining their full accessible text and the visible turn suffix.
- Apply perspective consistently to history actors, join/undo notices and announcements. Numbered seats remain in the Game card and raw/debug evidence. A future vacant seat uses Red/Blue rather than an assumed opponent identity.
- At every width, the History top has only Return to live view. Undo and Create a new game belong to move rows, including removal of the old top-level Undo last move.
- Desktop board sizing adapts to available height, targeting1440×800 at100percent zoom. Preserve comfortable36px mouse/44px coarse-pointer cell floors and use document scrolling in short windows. Cold cards and all100grid cells match loaded geometry, including first visible frames before fonts settle.
- Remove redundant control-rule explanations and internal device/runtime copy from normal player surfaces. Keep useful event, error, approval and recovery information.
- Authenticated optimistic game creation and branching use the public profile already known for that same captured account and transport identity. Computer seats use their known computer identity. Expanded participant details update safely when an authoritative profile arrives.

## Confirmed loading reference

The user chose the current reference, preserving its cut-stone shapes, sizing and vertical settling motion. The isolated comparison uses the actual Manrope font, Red and Blue colors and the real message-height reservation. Literal font punctuation, a separate cluster and a contextual hybrid were considered but not selected. Production at the time of diagnosis still used the earlier direct-to-text cue without the upcoming board sibling spacing. Shared inline cue spacing now carries the approved separation; board hosts must not add it twice. Keep button and standalone-region spacing appropriate to those existing components, with readable contrast on filled controls.

The comparison passed Chromium and WebKit at320/390px and100/200percent text. Phase changes retained cue nodes and animations, preserved board position, avoided horizontal overflow and respected reduced motion. These comparison results do not replace the required actual-app and production proof on desktop and mobile.

## Validation

Use focused pure-rule and scope tests for explanation causes, phase deadlines and identity fences. Use the actual board adapter/runtime for inactive selections, frozen sequence restrictions, blocked targets and read-only inspection. Verify no old floating selection labels remain, no unavailable action is shown and required continuation controls survive.

Check event placement in all three browsers at320/390px and enlarged text, including clustered events, scroll, resize, hidden panels, static boards and disposal. Inspect original screenshots. Check message geometry across loading, thinking, checking, saving, inspection and completed-turn replay, preserving cue identity and player color.

Hold an actual authenticated game creation before server admission to verify both optimistic participant rows, public-profile action, focus and expanded details before and after the canonical response. Verify computer seats separately. Run the complete relevant web suite, type checking and generated-source verification sequentially with regeneration before consumers. Final release gates require the actual merged prerequisite base, current strict CI, released validation and production proof. Preserve failed attempts separately and report incomplete checks honestly.

## Recovery investigation coordination

The recovery investigation is implementing separately. Its user-authorized merge and deployment follow actual150, ahead of154; larger-storage writer activation is not authorized. It owns storage codec/archive compatibility, API and proxy error boundaries, durable delivery and recovery scheduling, compact projection/history contracts and eventual recovery severity. This stream owns board geometry and activity presentation, narration/replay, contextual explanations, home identity/presence and undo viewing intent. Integrate shared files through committed source and actual merged bases. Never copy another stream's uncommitted edits.

Current release ledger,2026-10-25:

| PR | Candidate or actual source | State |
| --- | --- | --- |
|153|74a0c30b8c16afb66fa54e063e4d8fd768ca4364|Merged and deployed; combined155/153 production proof passed |
|157|ce0dd6e0ed1928215f1ec14b3519c361fe90c511|Merged, deployed and installed clean; main CI35/35 and installer/template parity passed |
|150|b7661ce9616283445a50c919324b1cc24092f91e|Actual squash merged and deployed; main CI35/35, trained play and natural End Turn/Pass production proof passed; every smoke game retained |
|158|49cc23f432df1452926e0ad2fda05f634102d59e|Actual150 base; current CI35/35 passed, canonical auth/capture repairs proved; released fresh/retained validation is next |
|161|f4f9b9d643569a37c74c0983bd61a65e5e9a704d|Current CI35/35 and strict old/new action selector contracts passed; refresh actual158 before release/install |
|154|d7f84a8bf6c34302c815a053f2ccdff9097b2556|Actual150 base, strict CI35/35 and trained play passed; refresh actual158/161 before final release proof |
|149|6beac7ea7cf1ebbd7e7fdaa894a2795ebea59ff9|Local reviewed prework; refresh actual prerequisites |
|151|366b7d2ab5b2a0c2ebe4a31f9eb032942ca67061|Compatibility cleanup staged; preserve supported readers and durable journals |
|152|eac034563379dc1f61e8dfc71a3019436b5be7fc|Local lead head; earlier remote CI green; actual prerequisite integration pending |
|156|c21a69ea2593f8fb06e341a5b03a97ae59c49fcd|Draft with local proof; refresh actual presentation prerequisites |
|159|40d8a84 plus shared test registry|Draft; combined1068web/type passed,24held-edge and30message cases passed across all three browsers; protected-history auth-loop repair proved in8 relevant workflows; actual-base/released/production gates pending |
|160|fb8d0cf plus source-owned repairs|Real computer activity and Resume here; actual presentation/recovery integration and remaining browser proof pending |

Authorized remaining release order is158 critical recovery,161 tooling release/install,154,149,151,152,156,159 and160 with actual prerequisites integrated. Root coordinates one deployment at a time. Merge/deployment authority for the recovery streams was verified directly from their user instructions. This does not authorize storage/model writer activation. No production resets, account/storage generation changes, retention cleanup or game deletion are authorized. Every synthetic smoke game is retained.

This UX sequence introduces no new large-storage representation. Before any larger-payload writer is activated, the storage stream must record the merged reader capability and rollback compatibility. Any remaining candidate here must refresh from that actual merged source and retain it, so a later UX deployment cannot restore an older incompatible reader. Add source SHA and representation/read capability to each release receipt once such a capability exists.

Pass remains a top-level action. End Turn closes an eligible sequence. The retained legacy adapter is replay-only, guarded by exact canonical hashes and original provenance. It does not silently reinterpret a live durable command or mint a replacement command ID. The reported older-client stuck Pass must be classified accepted/rejected/unknown from actual deployed receipts/contracts, separately from historical replay conversion.

Ordinary saving text must never conceal an actionable recovery error. Accepted undo returns the requester to live only if viewing intent has not changed since the request; away-and-back counts as changed. New mutation receipts and lazy history must preserve that token and identity rule. Replay remains visual-only. Home computer presence dots mean a computer player is available as an opponent. The Players card instead uses the real session activity owned by160.

Combined future proof must cover retained Pass/End Turn boundaries and original durable envelopes, lost replies, undo intent, lazy/evicted history, human/computer replay, mobile suspension, two tabs and quiet actual desktop/mobile presentation. Use pinned tools, keep publication paused and preserve all production records. Earlier timeout reports do not prove one universal historical server cause.

Migration0022 is reserved to the recovery stream for history metadata representation. Both new writers remain off. The158-capable client/server pair is the rollback floor for shared journals unless a verified drain permits an older pair. Do not reuse another stream's processes or start concurrent heavy matrices. Training generation/model workers do not overlap queued or running heavy/browser validation; admission and resumption require an explicit resource handoff.

The separately user-authorized computer-tab recovery stream supersedes semantic-only presence in the Players card. It owns real session status and expandable Resume here, while home dots remain semantic. Consume committed recovery PR158 and this follow-on's committed Players module5e16db4, followed by the complete83a540c app integration. Do not copy dirty source. Keep the small Computer badge, neutral names, colored emblems and focus/expansion stability. Its automatic notice remains delayed30seconds and explicit card recovery is immediately available subject to permission and pending-state rules. Its independently verified user deployment authority remains subject to actual prerequisite integration, current gates and coordinated release.

The board swipe study is a separate design decision, with Current wash, Stronger pigment, Stone ribbons, Solid planes and Edge cut. It compares held pulse and sweep motion without changing production animation. The current24percent transparent pigment multiplied by55–100percent pulse opacity explains the visible13–24percent color strength. The user selected Edge cut. Evolve it along the outer stone silhouette/bevel, outside the card face, with additional clearance masks for headings, message labels, axes, board and controls. Keep full-strength Red/Blue motion while loading is held, no translucent content wash, no added padding or layout size. Validate320/390/768/944/1440 and enlarged text, including motion, scroll, resize, quiet/idle removal and reduced motion.

### Earlier validation checkpoints

The following paragraphs preserve the investigation sequence. Their pending checks are superseded by the final local checkpoint below.

Edge-cut acceptance checkpoint: component checks passed in all three browsers across320/390/768/944/1440 width and enlarged-text combinations. The actual12-case card/grid pass completed11/12 at83a540c. Firefox200percent text exposed a1.5px message-line expansion during Manrope loading. Inline tokens now align to the explicit line box rather than the font x-height; the isolated held-font measurement is144px before and after. Final actual ready-state screenshots and the complete repaired matrix remain pending. The strengthened test originally expected a Pass affordance on an open-seat friend game, where Waiting for the game is correct. Preserve that failed fixture attempt separately and establish a genuine self-play ready state before reloading.

Final integration copy audit must retain the perspective rule in result spectator names, rematch side labels and accessible announcements. Numbered seat labels remain only in the Game card and debug/protocol evidence. Do not mistake raw seat constants or canonical history fields for user-facing copy.

The corrected self-play Firefox case passed after both repairs. Its local read-only diagnostic proved that control, legal Pass and account admission were ready while the DOM still said Waiting for the game. Both unchanged-snapshot paths now refresh status without replacing canonical state, selection or ongoing cue identity. Two runtime integration regressions pass, and the actual cold reload test covers the caller. Normal and200percent coordinate/Pass originals were inspected. Allbrowser resources were released to150 official proof; the final12-case matrix is still pending. An enlarged desktop header logo/control layout oddity is recorded for a bounded follow-up before final visual acceptance.

Additional coherent repairs: wide headers now use two real tracks for logo and utility controls, removing the unused32rem notification track that collapsed the logo at200percent text. Existing desktop acceptance checks cover1440/944 widths, usable logo size, one row,44px targets and overflow. Browser proof remains queued. Configured computer identity now survives manual control in static Home API cards and full-game-to-card normalization, independently of effective move permissions. Explicit human configuration clears stale computer markers; cards expose no lease/owner/control data. Failing-first API projection and actual HTTP list regressions reproduced the issue, then12 focused API checks passed. The complete relevant web suite passed1054/1054 and current type checking passed. Root reviewed the API repair; shell independently reviewed frontend identity with no findings.

### Final local checkpoint

Final local checkpoint: the held-font cold cases passed9/9 in all three browsers. The three desktop/header cases passed after correcting test comparisons to button centers and a subpixel floating-point threshold. Subsequent shared side-card proof passed12/12, including9cold cases with0px differences in Game, Players and History card edges, plus three actual Home manual-computer identity cases. Row positions/heights are asserted within1px; heading rectangles are retained as evidence but are not separately asserted. The shared preview uses real typography and renderer slots, including quiet feedback/footer boxes; it does not invent interactive controls or cache private identities. Arbitrary unknown history/viewer/notification content may legitimately change height.

The canonical overdue-save presentation repair from387b0ea/4d854a3 is ported without API, transport or envelope changes. Initial saving stays quiet, delayed notices remain separate, and15-second or immediate deterministic/auth/storage errors expose recovery actions even while computer saving is active. Thirty-three focused checks and the combined1061web checks passed. Browser recovery execution on this exact follow-on remains pending. Source and UI-guard integration received bounded review with no blocking findings. Earlier failures and their source provenance remain in private evidence.


### Follow-up browser and auth findings

The stronger held-route checks exposed a real Firefox animation defect: a native animation clock ran while the Red stroke offset stayed fixed. Unitless calc values were invalid SVG length endpoints. Explicit px endpoints preserve the2.4-second timing,500-unit separation, colors and polygon geometry. A native old/new value comparison reproduced the difference;24 affected invitation/history/loading cases now pass in all three browsers and require both colored paths to advance.

Actual32-character spectator names exposed a second height shift. Optional verified actor-prefix metadata now bounds only the displayed name, retaining full DOM/title text and bidirectional isolation. Coordinates and action labels stay visible. Matching name/text/button nodes update in place, preserving replay focus. Sixty-eight focused checks and30 browser cases pass at320/390 and normal/enlarged text without increasing the normal three-line reservation. Earlier nine failing name cases remain retained.

Auth traces proved that automatic additional-history metadata probes on unsigned/legacy account deployments repeatedly received401 and retired account dialogs. A guarded read now uses current account readiness/authentication and legacy ownership, with the same fence on scope callbacks. Ordinary public moves, guest deployments and valid signed-in observers remain available. A failing-first actual-render/controller regression proves no protected request or authority reset across repeated unsigned/legacy renders, while valid viewers still probe once. Unchanged Chromium registration and legacy cutover workflows pass with zero history401s; six profile/focus/disclosure cases pass across all three browsers. Tests establish keyboard focus before activation and explicitly expand the collapsed viewer summary, preserving the intended interaction rather than older presentation assumptions.

The combined web suite now passes1068 checks. Source changes and representative originals received bounded reviews. Current draft CI failures and superseded runs remain preserved; canceling stale pre-base runs only frees recovery-first runner capacity and does not waive final current-head CI. Final actual prerequisite integration, released validation and production proof remain required.

Remaining copy/icon follow-up: remove the redundant approval-dialog explainer; apply the existing angular glyphs to remaining board, move-history and Players actions while keeping labels and compact hit targets. Board glyph markup must be shared with sizing replicas and preserve live action nodes. Spectator result/rematch naming still requires its explicit tooling contract update at final integration.
