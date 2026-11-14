# T-142 native-browser acceptance

Run against the exact candidate head with the repository's supervised local web/API stack. Use fresh test-owned games only. Chromium is the primary behavior run; repeat the native animation and held-input boundary in Firefox and WebKit. Reuse the durable Node proof for the complete move/project/rush/push/retreat/follow action-kind matrix.

## Acceptance script

| ID | Native check | Acceptance |
| --- | --- | --- |
| N01 | In an actionable game, hold reconciliation while Pass is visible. Sample before 4 seconds, just after 4 seconds, and across one 2.4-second cycle. Repeat with End turn. | Control remains in place with unchanged text and dimensions. It is unavailable immediately, stays static through the existing visible-wait grace, then pulses without becoming enabled. |
| N02 | Select a legal move destination, then hold reconciliation. Inspect the selected source, destination, prompt, affiliation, and route arrow. | Selection and prompt remain stable. Only the destination confirmation and its arrow become neutral and dashed; only the destination surface pulses. The piece/source never pulses. |
| N03 | While N02 is blocked, inspect the selected and opposing pieces and switch inspection layers. Restore the action preview. | Inspection remains usable and never submits or queues a command. The prepared action is still selected when returning to it. |
| N04 | Press and hold the destination with a pointer. Cross healthy → unavailable → healthy before release. Repeat with Enter on Pass or End turn, including a repeated keydown. | No action is submitted by the spanning press or repeated key. A later deliberate activation submits exactly once with ordinary authority checks. |
| N04T | In touch-emulated Chromium, touch and hold a selected destination across the same healthy → unavailable → healthy transition, then release. Perform one fresh tap after recovery. | The spanning touch submits nothing and does not replay. The fresh post-recovery tap submits exactly once through ordinary authority checks. Record pointer type and command count/identity. |
| N05 | During a pulse, background the page for longer than one cycle, then return. Separately retire or supersede the recovery owner. | Hidden time does not advance visible-wait ownership. Foreground resumes from the current fenced incident. A retired/superseded incident stops decorating the surface and cannot submit. |
| N06 | Enable reduced motion, then forced colors, while the same recovery is held. | Unavailable state remains clear and static; there is no animation. Native focus, selection, destination, and prompt remain visible. |
| N07 | Release reconciliation in each prior case. | Pulse and neutral/dashed treatment retire from the same nodes, ordinary player-color presentation returns, and no command was created before the explicit post-recovery activation. |

## Representative continuation coverage

- Chromium: move, project, Pass, End turn, plus one multi-step rush and one push/retreat/follow continuation. Run N04T in an actual touch-emulated browser context, not by dispatching synthetic DOM events.
- Firefox: N02, N04, and N06 at the approved responsive width and 200% text.
- WebKit: N01, N04, and N06 with keyboard focus visible.
- Durable automated coverage remains the authority for every action-kind mapping and negative boundary; native proof answers rendering, timing, focus, and real input behavior only.

## Evidence manifest

Record one row per acceptance ID and browser:

- Exact candidate commit, browser name/version, viewport, zoom/text setting, color/motion preference, and fresh game ID label.
- Before-grace, pulsing, and recovered screenshots for N01/N02; static preference screenshots for N06.
- Sampled control/destination rectangles, animation name and duration, neutral dash state, disabled state, and selected-piece/destination identity.
- Command count and command identity before the hold, after the spanning input, after recovery, and after the deliberate activation.
- Recovery episode/generation before and after backgrounding or owner retirement; do not retain identity, authentication, or game payloads.
- Pass/fail with the exact acceptance ID, evidence paths, and any explicitly deferred physical-device risk.

Stop and report rather than weakening authority if an actual recovery hold cannot be produced by the supported local fault fixture. Do not simulate acceptance by merely adding CSS classes.
