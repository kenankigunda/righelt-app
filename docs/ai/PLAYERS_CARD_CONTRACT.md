# Players card contract

This describes approved intended behavior. Product wiring, current-head checks and deployment proof remain separate. Provenance: [D04, D09, D11](../UX_FEEDBACK_AUDIT.md#october-29-to-november-1-decision-index).

## Identity and hierarchy

Use Players as the heading, the two player rows, then a subordinate Viewers section. For zero viewers show None. One viewer appears directly. Multiple viewers use a native expandable audience. Viewer invitation actions follow the audience. Keep distinct stable keys for duplicate names and preserve expansion/focus through presence updates.
The Players card contains two player rows and permitted player invitations, followed by a smaller `h3` Viewers subtitle. The subtitle has no count. Viewer invitations follow the audience and its expanded roster. Preserve the existing invitation, join, approval, pending and permission checks. Completed games show viewing controls, without invitations or controls to play.

`renderPlayersPanel(game, options)` renders the two player rows. `renderViewersPanel(game, options)` renders the Viewers section, including an optional trailing action area. Both retain the captured identity, public profile actions, presence labels and stable identity keys.

The audience has three states:

- No viewers: a quiet group icon and None, with no disclosure.
- One viewer: the identity and presence appear directly, with no disclosure.
- Two or more viewers: a native details/summary disclosure. Its compact line shows both names for two viewers, or two names and the remaining number for a larger audience. When expanded, the same summary says N viewers, followed by the complete roster. Invite someone to view remains below the roster.

Actual names use their affiliation colors and follow the [shared identity policy](../UX_PRINCIPLES.md#identify-people-and-visual-roles-separately). Keep public profile expansion and full accessible labels. Guest numbering is stable by saved seat. Emblems, human presence and computer activity carry different meanings. Shared computer-owner identity or temporary takeover does not imply that a human owns both human seats.

Use native Enter and Space activation, a visible disclosure marker, visible keyboard focus and at least 44px touch height. Names wrap; the roster uses natural page scrolling without a nested scroll box. Invitation text stays neutral, with restrained affiliation color on its icon, including inside the loading-icon wrapper. Keyboard focus within Viewers scrolls a control clear of an overlapping floating navigation bar; pointer focus does not move a click target.

Expansion belongs to the current game visit. Preserve it across roster and presence updates in the same game, and reset compact when navigating to another game or changing account. Native click intent is captured before the queued toggle event so a refresh cannot restore the previous state. Ignore toggle events from detached disclosures. If a refresh removes a focused disclosure because fewer than two viewers remain, restore only that control's focus to the Viewers heading. Do not claim focus from another control or the page.

Seat emblems carry Red/Blue affiliation. Opponents and spectators see anonymous names Guest 1 and Guest 2 by saved seat. The owning human’s main label is You, or You · Red / You · Blue for genuine human self-play. The actual canonical name remains in expanded profile details and the accessible label. Profile actions, editing and stable identity keys do not change. This confirmed November 11 exception supersedes D04’s older actual-name-only examples for these viewer-relative surfaces. Computer rows show their name and bot icon with an accessible Computer player description. Preserve completed-game status, deliberate computer disclosures, historical analysis and Undo behavior from their canonical feature modules.

Invitation feedback and fallback links stay with the relevant Players or Viewers section and are announced once. Sharing a viewing link grants no play authority. Roster expansion performs no server mutation and does not alter live board selection or history.

Product checks cover 0/1/2/many viewers, named and guest identities, long names, open seats, computer and completed states, keyboard operation, presence refresh, disclosure focus removal, invitation copy/failure, and native navigation between games. The study is a visual reference; it does not replace product authority or browser validation.
## Computer activity

Players uses real runner/control activity, rather than Home's semantic computer presence. The approved neutral bot with an overlapping Corner badge replaces the bot-plus-circle pair. Ordinary status words are icon-only visually, including expanded details, and remain in the row's accessible name and shared hover tooltip. The row is the sole disclosure target. Recovery actions remain available under existing permissions and disabled explanations.

The [web app computer contract](../RIGHELT_WEB_APP_SPEC.md#computer-identity-and-activity-in-players) owns the approved sizes, colors and state symbols. Consume the activity producer without inventing ordinary thinking/saving states or changing leases, admission or runner authority. Players-only scope does not expand these live states to Home. Finished games cannot resume calculation. Confirmed final playback is a bounded presentation exception.

## Result perspective

Results use confirmed outcome and saved human-seat ownership. A seated winner sees You won. A loss names the winner, such as Maya won. Spectators see the actual winning name. Draw stays Draw. For genuine self-play, use You won as Red/Blue for the human and {name} won as Red/Blue for viewers only when needed to disambiguate, with the actual winning affiliation. Do not derive perspective from temporary manual computer control. Keep accessible color distinctions.

[Commander feedback](COMMANDER_RESULT_FEEDBACK.md) owns cause, artwork and effect lifecycle. [Completed-game behavior](../RIGHELT_WEB_APP_SPEC.md#completed-games-and-play-again) owns review-only controls and rematch eligibility. Old neutral-name and numbered-winner examples are superseded.

## Acceptance

Verify both affiliations, duplicate and long names, one/two guests, none/one/many viewers, human/computer/both-side ownership, spectator and temporary-control negatives. Cover keyboard disclosure, focus preservation, row/Resume touch targets, tooltip lifecycle, native modal coexistence, 320/390px widths, 200% text, forced colors and reduced motion. Source/component checks are not real account or release proof.
