# Players card contract

The Players card contains two player rows and permitted player invitations, followed by a smaller `h3` Viewers subtitle. The subtitle has no count. Viewer invitations follow the audience and its expanded roster. Preserve the existing invitation, join, approval, pending and permission checks. Completed games show viewing controls, without invitations or controls to play.

`renderPlayersPanel(game, options)` renders the two player rows. `renderViewersPanel(game, options)` renders the Viewers section, including an optional trailing action area. Both retain the captured identity, public profile actions, presence labels and stable identity keys.

The audience has three states:

- No viewers: a quiet group icon and None, with no disclosure.
- One viewer: the identity and presence appear directly, with no disclosure.
- Two or more viewers: a native details/summary disclosure. Its compact line shows both names for two viewers, or two names and the remaining number for a larger audience. When expanded, the same summary says N viewers, followed by the complete roster. Invite someone to view remains below the roster.

Use native Enter and Space activation, a visible disclosure marker, visible keyboard focus and at least 44px touch height. Names wrap; the roster uses natural page scrolling without a nested scroll box. Invitation text stays neutral, with restrained affiliation color on its icon, including inside the loading-icon wrapper. Keyboard focus within Viewers scrolls a control clear of an overlapping floating navigation bar; pointer focus does not move a click target.

Expansion belongs to the current game visit. Preserve it across roster and presence updates in the same game, and reset compact when navigating to another game or changing account. Native click intent is captured before the queued toggle event so a refresh cannot restore the previous state. Ignore toggle events from detached disclosures. If a refresh removes a focused disclosure because fewer than two viewers remain, restore only that control's focus to the Viewers heading. Do not claim focus from another control or the page.

Seat emblems carry Red/Blue affiliation. Two anonymous players use Guest 1 and Guest 2, including the current player's visible row; the accessible label still identifies ownership. Computer rows show their name and bot icon with an accessible Computer player description. Preserve completed-game status, deliberate computer disclosures, historical analysis and Undo behavior from their canonical feature modules.

Invitation feedback and fallback links stay with the relevant Players or Viewers section and are announced once. Sharing a viewing link grants no play authority. Roster expansion performs no server mutation and does not alter live board selection or history.

Product checks cover 0/1/2/many viewers, named and guest identities, long names, open seats, computer and completed states, keyboard operation, presence refresh, disclosure focus removal, invitation copy/failure, and native navigation between games. The study is a visual reference; it does not replace product authority or browser validation.
