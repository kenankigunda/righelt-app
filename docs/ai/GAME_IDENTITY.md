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

Game routes use `<matchup> | Righelt`. Loading, inaccessible, and unresolved invitation states use `Loading game | Righelt`, `Game unavailable | Righelt`, and `Invitation | Righelt`. Other routes use `Righelt`.

The complete browser title has a 40-grapheme budget. If needed, shorten the longer human name to its Unicode-safe first initial plus a period, then shorten the other human name. Preserve `You`, computer names, and generic seat labels. Retain a known matchup while the same route reconnects, but clear inaccessible identity after route or access changes.

## Tessera v1

Each game renders a decorative 3×3 Tessera derived only from its complete immutable game ID and the versioned `righelt:tessera:v1` seed. Known-answer tests lock the geometry and palette. Repeated SVG instances use no document-global IDs or clip paths.

Dynamic per-game favicons and the action-awaiting notification dot are intentionally deferred to the immediately following favicon PR. They must reuse this identity model without coupling document icons to transport authority.
