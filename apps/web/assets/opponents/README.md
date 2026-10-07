# Righelt story artwork

T-087 narrative illustrations generated with the built-in image-generation tool, revised October 6, 2026. Production WebP files are self-contained. `manifest.json` records scene IDs, descriptive text, dimensions, byte sizes, and generation provenance.

## Current visual contract

Scenes fill their card generously. Plain ivory walls, linen, paving and negative space continue the card surface (#fffdf6). Use crisp selective boundaries, never fuzzy vignettes, feathered fades, halos, or CSS masks to hide a rectangular image. The scene scale follows available width and a 3:2 aspect ratio. The shared modal provides scrolling when needed rather than shrinking the art.

Babs retains the rainy window, shelf, lantern, books and chair across discovery, rematch and research. Tau retains his golden shell and garden irrigation setting. Horus retains his watchtower and courtyard setting. Each opponent has three scenes and the approved fixed story.

Game imagery uses faceted cut-corner units, stepped commanders with horizontal windows, and stepped supply arches. Supply markers occupy corner squares, never interior squares. These are narrative scenes, not legal-position diagrams or substitutes for the actual board renderer.

Friend is represented by hands only. The compact Start illustration retains the red/blue hand treatment. The larger introduction shows an invitation through an open palm, board, mugs and place settings. No full human figures or animal characters appear in Friend artwork. Animals remain exclusive to computer opponents. The earlier chair invitation is a preserved exploratory direction, not a runtime asset.

## Final prompt set and processing

The built-in edits preserve character identities, story actions and composition while replacing fuzzy boundaries with crisp architectural or garden edges and continuous ivory. Board edits reference the actual `apps/web/piece-symbols.js` shapes and explicitly require corner supply arches. Babs's wooden tabletop was replaced with ivory linen so its bottom edge meets the card naturally. Friend expands the approved faceted red/blue hands into a tabletop invitation, using the same piece references.

The final generated files were inspected before encoding. Only resizing and WebP encoding followed generation (`cwebp -q 90 -resize 1200 800`), with no synthetic fades or retouching. Tau's gardening scene has no gameplay and retains its clean transparent negative space. Friend also uses clean transparency. All revised scenes use clean transparent negative space so the actual card texture continues between crisp scene elements. No blend mode approximates the surface color. Inspect every future revision in the actual component at mobile and desktop sizes, including transitions, before accepting it.

Load the first image eagerly and defer subsequent scenes. A failed image must leave the story and controls usable. Artwork does not establish trained-computer readiness.
