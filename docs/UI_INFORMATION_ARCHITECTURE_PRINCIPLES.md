# UI Information Architecture Principles

This document defines shared information-architecture rules for compact UI surfaces such as game cards, summaries, and future shell metadata rows.

## Core Principle

- Equivalent pieces of information should occupy equivalent vertical positions across sibling surfaces.
- When one card or row omits optional supporting content, preserve the baseline of the remaining shared content rather than letting the stack collapse.
- This keeps scan patterns stable and prevents role, status, or timestamp lines from visually "jumping" between adjacent cards.

## Game Card Rule

- In home page game cards, the primary role line must appear at the same height whether the player controls one seat or both seats.
- Removing optional supporting copy, such as local self-connection text, must not change the vertical placement of the role line relative to neighboring cards.
- When necessary, reserve the missing row with hidden placeholder space instead of introducing visible filler copy.

## Future UI Guidance

- Apply this rule anywhere we present repeated metadata stacks, including future game cards, summaries, flyouts, and side-by-side status surfaces.
- Treat stable row ordering and stable row height as part of the product's information architecture, not just a visual polish detail.
- If a design change removes one row from only some siblings, explicitly decide whether a placeholder or other layout reservation is needed to preserve alignment.

## Mobile Screen Real Estate Principle

- On narrow mobile layouts, shared shell routes should use the smallest safe outer gutters that preserve readability and tap comfort.
- The home page should follow the same screen-real-estate maximization rule as the game page instead of reserving extra horizontal chrome by default.
- When we tighten mobile gutters for one primary shell route, treat that as a shared shell principle and document whether sibling routes should inherit it.

## Hover Capability Principle

- Button and button-link hover styling must be gated by `data-hover-capability="hover"`.
- Treat hover styling as progressive enhancement only and do not make required behavior depend on hover availability.
- When adding new interactive hover affordances, verify that non-hover and touch devices preserve the same required behavior without hidden-only states.
