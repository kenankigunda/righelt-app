# Game identity and matchup titles

Game identity is presentation only. It must never grant authority, change seats, or become a storage key.

## Matchup text

- Use one saved-seat matchup model for Home cards, the Game summary, result panels, and browser titles.
- A player sees their saved human seat first as `You`; viewers see Red, then Blue.
- Resolve each seat as computer profile name, display name, username, then `Guest`. Two anonymous humans are `Guest 1` and `Guest 2`; an empty seat is `Open seat`.
- Saved self-play is `You play both sides` for its owner and `<name> plays both sides` for a viewer.
- Temporary computer control does not rename either seat.
- Use the exact separator `vs.`. Keep full visual titles and isolate user text with `bdi`.
- Presence appears only on ongoing Home cards: an owner sees the opponent state, a viewer sees both states, and completed cards show none.

## Browser title

Game routes use `<browser matchup> | <Mon D> | Righelt`, with the date derived from the game's immutable `createdAt`. Browser self-play shortens the in-app `You play both sides` or `<name> plays both sides` copy to `You` or the participant name. Loading, inaccessible, and unresolved invitation states use `Loading game | Righelt`, `Game unavailable | Righelt`, and `Invitation | Righelt`. Other routes use `Righelt`.

The complete browser title has a 40-grapheme budget. If needed, shorten the longer human name to its Unicode-safe first initial plus a period, then shorten the other human name. Preserve `You`, computer names, and generic seat labels. Retain a known matchup while the same route reconnects, but clear inaccessible identity after route or access changes.

## In-app identity marks

Home cards and the Game summary use a date inlay derived only from the game's immutable `createdAt`. Its fixed-size slot prevents nearby title movement, and its accessible label exposes the full localized start date and time.

Participants use decorative 3×3 Tessera v1 marks derived from stable presentation keys with the versioned `righelt:tessera:v1` seed:

- Accounts: normalized username.
- Guests: immutable guest identity ID.
- Computers: computer profile key.

The same participant keeps one mark across games, seats, display-name changes, turns, and temporary control. Different stable identities receive different keys. Known-answer tests lock Tessera geometry and palette. Repeated SVG instances use no document-global IDs or clip paths.

The document icon remains separate from in-app game and participant identity. It uses the shipped marble favicon, adding the action-awaiting notification dot only when final authoritative action availability says the viewer can act. It never infers authority from transport or presentation state.
