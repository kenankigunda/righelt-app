# Image generation and validation

Apply this before every Righelt illustration generation, edit, export and acceptance. These rules govern prompting and review. They do not guarantee that an image model produces correct output. Inspect the result, correct failures and recheck preserved properties before calling it ready. Read the [material contract](MATERIAL_UX_CONTRACT.md) and the asset consumer's current selected brief.

## Before generation

Identify the exact consumer, intended display sizes, selected reference properties and latest decisions. List the properties being changed and those locked for preservation. Use the actual native geometry and game state as references where the illustration depicts them, rather than a previous generated approximation. A generated reference can contain an already rejected mistake.

Use one focused edit for a bounded correction. Repeated edits can soften detail or reintroduce rejected shapes. If quality degrades, restore/re-render from the best clean approved reference with the full preservation list. Do not preserve fuzzy pixels merely because they came from the latest version. Preserve the recognizable scene, not accumulated artifacts.

Include the relevant checks below directly in each generation/edit prompt. A generic “same style” or “make it crisp” instruction is insufficient.

## Required checks after every generation or edit

| Check | Pass condition / correction rule |
|---|---|
| Crisp material and contours | Sharp intentional faceted boundaries, clean silhouettes, clear marble veins, straight grid ridges and intersections, readable openings and distinct token edges. Reject blur, smudged patches, duplicated/ghost contours, fuzzy halos, noisy resampling and loss of detail from repeated edits. Do not substitute oversharpening fringes or crunchy noise. Inspect full scene at intended size and original-resolution details. A larger pixel count alone is not a pass. |
| Native piece identity | Use [piece-symbols.js](../../apps/web/piece-symbols.js). Units are clipped octagons. Commanders have beveled shoulders, enclosed horizontal rectangular windows and continuous colored bases. Supplies have stepped arches with bottom openings. Reject commanders that become supply arches, generic castles, tall blocks or ambiguous silhouettes. Recheck this after unrelated edits. |
| Footprint and perspective | Pieces fit their intended individual squares, preserve approved thin/flat proportions and agree with board perspective. Reject a wide commander spanning adjacent cells. Do not enlarge pieces to make windows readable at the expense of footprint. |
| State fidelity | When the brief depicts a particular game state, verify occupied cells, count, types, owners and coordinates against source. State whether coordinates are row/column and how perspective maps to the board. Do not claim a setup is correct because it looks plausible. A narrative scene without a specified state is not an executable fixture. |
| Affiliation consistency | Chair, mug, reserve pile and board-side colors agree within the chosen composition. Reject mirrored/swapped assignments. The art's near/far seating orientation is not a universal gameplay seating rule. |
| Layout and inventory preservation | Keep all locked objects, positions, proportions, scene identity, characters and copy unchanged unless explicitly selected otherwise. No extra/missing pieces, duplicated props, new frames or unintended cropping. Check the whole preservation list after every local edit. |
| Surface integration and alpha | Complete deliberate silhouettes and clean transparency, or an explicitly approved exact matched surface. No opaque rectangle, colored fog, fuzzy vignette, glow, feathered fade or mask used to disguise a boundary. Merely having an alpha channel does not prove clean transparency. Composite over actual target material and contrasting backgrounds to expose fringes and residual matte. Preserve alpha during export. |
| Consumer scope | Change only the approved consumer. A modal image replacement does not replace a separate Home portrait. Preserve narrative copy, carousel, readiness, lazy-load, failure fallback, action reachability and cancellation. |
| Final export | Inspect the actual final encoded/resized file, not just generation preview. Recheck fine detail, windows, alpha, colors and file size at desktop/phone presentation sizes. No hidden CSS blur/blend/fade may disguise an unsuitable asset. Retain editable/high-quality source plus delivery asset provenance. |

## Review loop and evidence

Record source/asset revision, prompt, reference roles, output path/hash/dimensions, exact intended change, preserved properties, inspected crops/context and findings. Inspect the new result against both the latest selected brief and best clean reference. Preserve rejected evidence with bounded reasons. Do not report prompt compliance as observed image correctness.

Automatically correct identified failures within the approved direction, then recheck all relevant properties. Escalate only a genuine choice or scope conflict. A successful window fix cannot waive fuzzy marble, and sharpening cannot waive a regressed silhouette or state. Do not call a draft final while required checks fail.

UX validation checks style, sharpness, integration, scale and material fidelity. Product testing checks depicted state/identity, consumer boundaries and surrounding workflow preservation. Native rendering, provider/image-load failure and runtime behavior require their own proof. Image review alone does not establish implementation or deployment.

## Friend-specific selected example

This section is not a template for every illustration. The Friend Home card retains hands. The Friend modal shows a welcoming table with empty pulled-out ornate chairs, in the faceted computer-story style. Marble game props, crisp imagery, matching side colors and regular units piled off-board are selected. Earlier simple/homey chairs are superseded.

For the selected unrotated ten-by-ten new-game view: red supply(row0,col9), red commander(row3,col6), blue commander(row6,col3), blue supply(row9,col0). Rows run far/top0 to near/bottom9; columns left0 to right9. Only those four objects are on the grid: two commander pieces plus two fixed supply points, not four entries in the engine pieces array. Reserve piles contain ordinary units, not extra commanders/supplies, and imply no fixed game inventory count. Blue-left/near and red-right/far furniture is this composition's affiliation choice.

Verify current source in [state.ts](../../packages/game-engine/src/state.ts) and [deterministic.ts](../../packages/game-engine/src/deterministic.ts). Preserve actual commander silhouettes and single-cell footprints. These state requirements apply when depicting a new game, not all story scenes.

The [T-118 reference register](https://github.com/kenankigunda/righelt-backlog/blob/main/backlog/docs/tickets/t-118/marble-2026-11-01/reference-register.md) retains the approval and rejection history. R32's shapes were approved, then its fuzzy artifacts were rejected. R33 is a quality-restoration candidate, not automatic acceptance of every pixel.
