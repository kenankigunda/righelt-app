# Contextual board feedback

This follow-on builds on the opponent, invitation and history work in PR156. Its release must preserve the deployed game records and model provenance. It does not delay the training handoff after the shared150/154 contracts are deployed and verified.

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

The recovery investigation is implementing separately. Its user-authorized merge and deployment remain coordinated behind150 and154; larger-storage writer activation is not authorized. It owns storage codec/archive compatibility, API and proxy error boundaries, durable delivery and recovery scheduling, compact projection/history contracts and eventual recovery severity. This stream owns board geometry and activity presentation, narration/replay, contextual explanations, home identity/presence and undo viewing intent. Integrate shared files through committed source and actual merged bases. Never copy another stream's uncommitted edits.

Current release ledger,2026-10-25:

| PR | Candidate source | State |
| --- | --- | --- |
|153|74a0c30b8c16afb66fa54e063e4d8fd768ca4364|Merged, main CI and deployment successful, tools installed at this clean revision; combined155/153 production proof passed |
|157|ce0dd6e0ed1928215f1ec14b3519c361fe90c511|Actual squash merged; fresh review CI passed35checks; main CI35/35 and deployment succeeded; installed tools verified clean atce0dd6e with installer/setup/template byte parity |
|150|544b624da49b614a5d4f461a18c1e1331a2bbf78|Actual157 base integrated; fresh trained-play and strict CI35/35 passed. Released157 installed; official validation has the next browser slot |
|154|e47baec52740640e335af1f984bb598ad99aabce|Local integration prework, refresh actual150 base before final gates |
|149|6beac7ea7cf1ebbd7e7fdaa894a2795ebea59ff9|Local reviewed prework, refresh actual prerequisites before release |
|151|366b7d2ab5b2a0c2ebe4a31f9eb032942ca67061|Compatibility cleanup staged; preserve its removal of unsupported fallbacks |
|152|eac034563379dc1f61e8dfc71a3019436b5be7fc|Local lead head; remote0b9bbf7 CI green; final actual prerequisite integration remains |
|156|c21a69ea2593f8fb06e341a5b03a97ae59c49fcd|Draft PR, local proof complete, refresh actual152/154 base before final gates |
|159|83a540c|Draft on156;1050web checks passed. Edge component6/6 and selected-message9/9 browser checks passed; actual cold matrix11/12 exposed Firefox200percent font shift, scoped repair under validation |
|158|6a777c2|Receipt/CPU recovery:828web,331API/runtime and8browser checks passed; actual150/154 refresh and released validation pending |
|160|Independent recovery stream|Real computer-tab activity and Resume here; actual presentation/recovery prerequisites must be integrated before deployment |

Authorized release order is153,157 tooling,150,154,158 critical receipt/CPU recovery,149,151,152,156,159 and160 with actual prerequisites integrated. The engine stream owns150 deployment, then the board stream154, with root coordinating one deployment at a time. Merge/deployment authority for the recovery streams was verified directly from their user instructions. This does not authorize storage/model writer activation. No production resets, account/storage generation changes, retention cleanup or game deletion are authorized. Every synthetic smoke game is also retained.

This UX sequence introduces no new large-storage representation. Before any larger-payload writer is activated, the storage stream must record the merged reader capability and rollback compatibility. Any remaining candidate here must refresh from that actual merged source and retain it, so a later UX deployment cannot restore an older incompatible reader. Add source SHA and representation/read capability to each release receipt once such a capability exists.

Pass remains a top-level action. End Turn closes an eligible sequence. The retained legacy adapter is replay-only, guarded by exact canonical hashes and original provenance. It does not silently reinterpret a live durable command or mint a replacement command ID. The reported older-client stuck Pass must be classified accepted/rejected/unknown from actual deployed receipts/contracts, separately from historical replay conversion.

Ordinary saving text must never conceal an actionable recovery error. Accepted undo returns the requester to live only if viewing intent has not changed since the request; away-and-back counts as changed. New mutation receipts and lazy history must preserve that token and identity rule. Replay remains visual-only. Home computer presence dots mean a computer player is available as an opponent. The Players card instead uses the real session activity owned by160.

Combined future proof must cover retained Pass/End Turn boundaries and original durable envelopes, lost replies, undo intent, lazy/evicted history, human/computer replay, mobile suspension, two tabs and quiet actual desktop/mobile presentation. Use pinned tools, keep publication paused and preserve all production records. Earlier timeout reports do not prove one universal historical server cause.

Migration0022 is reserved to the recovery stream for history metadata representation. Its browser8791/8794 lane waits for the current bounded8790/8793 geometry matrix to release the heavy browser window. Do not reuse another stream's processes or start concurrent heavy matrices.

The separately user-authorized computer-tab recovery stream supersedes semantic-only presence in the Players card. It owns real session status and expandable Resume here, while home dots remain semantic. Consume committed recovery PR158 and this follow-on's committed Players module5e16db4, followed by the complete83a540c app integration. Do not copy dirty source. Keep the small Computer badge, neutral names, colored emblems and focus/expansion stability. Its automatic notice remains delayed30seconds and explicit card recovery is immediately available subject to permission and pending-state rules. Its independently verified user deployment authority remains subject to actual prerequisite integration, current gates and coordinated release.

The board swipe study is a separate design decision, with Current wash, Stronger pigment, Stone ribbons, Solid planes and Edge cut. It compares held pulse and sweep motion without changing production animation. The current24percent transparent pigment multiplied by55–100percent pulse opacity explains the visible13–24percent color strength. The user selected Edge cut. Evolve it along the outer stone silhouette/bevel, outside the card face, with additional clearance masks for headings, message labels, axes, board and controls. Keep full-strength Red/Blue motion while loading is held, no translucent content wash, no added padding or layout size. Validate320/390/768/944/1440 and enlarged text, including motion, scroll, resize, quiet/idle removal and reduced motion.

Edge-cut acceptance checkpoint: component checks passed in all three browsers across320/390/768/944/1440 width and enlarged-text combinations. The actual12-case card/grid pass completed11/12 at83a540c. Firefox200percent text exposed a1.5px message-line expansion during Manrope loading. Inline tokens now align to the explicit line box rather than the font x-height; the isolated held-font measurement is144px before and after. Final actual ready-state screenshots and the complete repaired matrix remain pending. The strengthened test originally expected a Pass affordance on an open-seat friend game, where Waiting for the game is correct. Preserve that failed fixture attempt separately and establish a genuine self-play ready state before reloading.

Final integration copy audit must retain the perspective rule in result spectator names, rematch side labels and accessible announcements. Numbered seat labels remain only in the Game card and debug/protocol evidence. Do not mistake raw seat constants or canonical history fields for user-facing copy.

The corrected self-play Firefox case passed after both repairs. Its local read-only diagnostic proved that control, legal Pass and account admission were ready while the DOM still said Waiting for the game. Both unchanged-snapshot paths now refresh status without replacing canonical state, selection or ongoing cue identity. Two runtime integration regressions pass, and the actual cold reload test covers the caller. Normal and200percent coordinate/Pass originals were inspected. Allbrowser resources were released to150 official proof; the final12-case matrix is still pending. An enlarged desktop header logo/control layout oddity is recorded for a bounded follow-up before final visual acceptance.
