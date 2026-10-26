# Players card integration checkpoint

This checkpoint provides shared presentation modules. App wiring and final browser/release proof remain in the broader UX follow-on. It is not a merge or deployment readiness claim.

`renderPlayersPanel(game, options)` renders the two seats and viewer disclosure. Options include the captured `identityId`, `expanded`, `pendingSeat`, `icon` and `formatStatus`. The host owns expansion state per game and handles `toggle-viewers`, rerendering without replacing the board. `participantButton` retains the existing public/guest profile actions and stable keys.

Seat emblems carry Red/Blue color. Names remain neutral and use You, display name, username fallback or Guest. Computer rows keep the name and small Computer badge. Seat color and human connection status are included in accessible names. Viewer summaries show two names, remaining named viewers as others, and guest counts. The current viewer is You in the first slot. Expansion retains every distinct identity, including duplicate display names.

The perspective helper separates permanent human identity from temporary computer takeover. Shared computer-owner identities do not imply self-play. Turn captions and history labels use the canonical actor, including a defender's retreat. Computer history entries retain computer names. The standalone participant-name block below History is removed by the later app integration.

The separately authorized computer-tab recovery stream owns the subsequent expandable computer row and real session status. Its Active here, Active in another tab, Resuming, Paused and Needs attention states supersede the static semantic computer dot in Players. It also owns Resume here and permission/pending explanations. Preserve the compact badge, colored emblem, neutral name, focus, expansion state and reserved board geometry. Home computer dots remain semantic. Consume committed sources and integrate against the recovery transport capability/receipt contract.

Focused unit checks cover ownership, guest numbering, viewer grouping, escaping, profile upgrade fencing and accessible identity. The earlier generic participant-row browser matrix is not final proof for this redesign. Complete keyboard/focus, long-name and enlarged-text browser checks after app integration. Preserve all production games and history.
