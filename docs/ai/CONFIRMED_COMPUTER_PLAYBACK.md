# Confirmed computer playback

Computer calculation, server acceptance and visible movement have separate owners.

- The computer runner may calculate a candidate before its predecessor is confirmed. It cannot save that candidate's evidence or submit it until the acknowledged revision, position hash, control generation, model, profile and account/transport scope match the expected position.
- Once a gameplay command is admitted, its durable journal owns retries and receipt recovery. Speculation never replaces, duplicates or recomputes an admitted command.
- Computer commands retain full local admission validation but do not project tentative pieces, captures, moves or turns into the visible game. Human commands keep their existing optimistic behavior.
- The display queue reads immutable acknowledged decisions and presents them in order. The displayed history and turn follow those frames. Human gameplay remains blocked until presentation finishes and the current rules grant control.
- Reduced motion presents discrete automatic steps without requiring a manual Next action. Explicit historical replay retains its existing manual reduced-motion behavior.
- Navigation, hidden or offscreen boards, account changes and replaced decision lineages cancel obsolete display work and establish a fresh baseline. Returning does not replay old movement or movement sounds.

## Messages and intervention

Board activity uses this priority: Needs help, Making their move, Thinking, Saving their move. Thinking requires active calculation. Saving describes confirmation-only waiting. A routine save, quiet recovery notice or transient resource retry does not make the Players card claim that intervention is required. An actual intervention remains visible even when the card was collapsed or offscreen and clears when the underlying condition clears.

A finished game stops automatic leases, computation, evidence retries and gameplay admission. Already admitted commands still settle through their journal. Explicit analysis, replay and Undo remain available; Undo uses the existing paused-computer reopening contract.

## Sound and unseen updates

Movement sound belongs to the displayed step, once per acknowledged move identity. Receipt delivery, duplicate snapshots and replaying an old step do not create another live movement sound.

An unseen update has a distinct, prominent ascending chime. A pending batch gets one initial chime and one reminder every 30 seconds through the existing shared timer. History, Players, tab focus and navigation alone do not clear the batch. It clears only when the live board is visible and pending presentation has finished. Muting and browser audio restrictions still apply. Account changes clear the prior account's pending notifications.

The update chime uses 460 Hz followed by 690 Hz, separate from the short 820 Hz movement cue, and shares the existing device volume and mute preference.

## Validation boundaries

Pure tests cover ordered bursts, immutable frames, cancellation, failed hydration and revoked callbacks. Real transport tests cover the display admission barrier without changing authority. Runner tests cover overlapping calculation with confirmation, expected-position mismatches and exact attempt identity. Native tests must cover held and lost acknowledgements, foreground and hidden delivery, History and Players reminders, final display admission, reduced motion and completed review.
