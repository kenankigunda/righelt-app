# Opponent story artwork

T-087 pass-one assets, generated with the built-in image-generation tool on 2026-10-03. These are narrative illustrations, not diagrams of legal board positions. No generated text or interface is used.

`manifest.json` records the three scenes for each opponent, descriptive alt text, intrinsic dimensions, encoded byte sizes and source generation IDs. The original tool outputs are retained by the generation service/local image history. The production deliverables here are self-contained WebP files; runtime must not reference that local history.

## Art direction and prompts

All prompts specify standalone 3:2 illustrations, angular geometric painted facets, consistent character identities, crisp selective edges, and ivory walls/tablecloths/parapets as actual scene surfaces. They exclude fuzzy vignettes, feathering, gradient fades, text, UI and logos. Existing story drafts and the accepted integrated-art modal in `righelt-backlog/backlog/assets/ppa-ux/` supplied composition and character references. The approved modal supplied art treatment only, never its superseded background wordmark.

The scene-specific prompt set was:

1. Babs discovers a board during a rainstorm: cream rabbit, navy neckerchief, curious joyful expression, rainy village window, lantern, trailing plant, red and blue round game pieces; replace the old vignette with an ivory wall and tablecloth.
2. Babs eagerly invites a rematch with paws spread over a reset board, cheerful sunny room and score notebooks; preserve the first scene's identity and framing.
3. Babs studies an impressive collection of research notebooks, pencil in paw, diagrams without readable text, cheerfully determined after a lost game.
4. Tau, a friendly green tortoise with a golden shell, waters village garden beds beside stone irrigation channels. Ivory garden wall and paving replace the old vignette.
5. Tau considers a board beside connected irrigation channels, illustrating the lesson of supply lines; clean ivory tablecloth fills the foreground.
6. Tau carefully considers a move while Babs rests her chin on her paws in amused patience; keep both identities consistent.
7. Horus, a slate-blue falcon with cream chest and golden eye, watches courtyard games from an ivory watchtower parapet.
8. Horus leans forward to study the game below, with a notebook of abstract red and blue diagrams; a closer viewpoint distinguishes this from the first scene.
9. Horus comes down to suggest a move to Babs and Tau, who listen with amused surprise; confident friendly rivalry, never cruelty.

Images were visually checked against these scenes and encoded with `cwebp -q 85 -resize 960 0`. No retouching, overlays or synthetic background fades were applied. All nine are 960×640 and together total 874,288 bytes. The UI should load only the selected opponent's first image eagerly, then defer subsequent scenes; artwork failure must leave the story and controls usable.

The consuming story modal and its account/model integration are delivered separately. Adding these assets does not claim that computer-play readiness or first-encounter persistence is implemented.

## Integrated artwork revision, 2026-10-04

Supersedes the original opaque-background encoding above. All nine scenes now use true transparent negative space, preserving opaque character/object colors and crisp, intentional contours. The surrounding component supplies its exact surface color (#fffdf6 normally), including on hover. No CSS masks or feathered fades disguise rectangular image edges. This integrated treatment is required for future narrative artwork too.

Tau and Horus were edited from the prior illustrations: preserve character identity, poses and story action; remove continuous landscape, plain wall, tablecloth and sky backgrounds; retain a few isolated garden/irrigation or watchtower/courtyard details; use roughly 40% transparent negative space around all edges. Babs uses the approved rainy discovery, eager rematch and notebook research vignettes, with the same transparency treatment. Production files are 1200×800 WebP, compressed with Sharp at quality 90 (Babs 92); current byte sizes and generation provenance are in manifest.json. Only compression/resizing followed tool generation.
