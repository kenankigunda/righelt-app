# Righelt story artwork

T-087 narrative illustrations generated with the built-in image-generation tool, revised October 6, 2026. Production WebP files are self-contained. `manifest.json` records scene IDs, descriptive text, dimensions, byte sizes, and generation provenance.

## Current visual contract

Scenes fill their card generously. Plain ivory walls, linen, paving and negative space continue the card surface (#fffdf6). Use crisp selective boundaries, never fuzzy vignettes, feathered fades, halos, or CSS masks to hide a rectangular image. The scene scale follows a responsive composition and its natural 3:2 aspect ratio. Wide introductions place the scene beside the story. Narrow introductions stack them, balancing scene height and copy so Play is visible at common default zoom. The shared inset viewport retains scrolling for genuine overflow.

Babs retains the rainy window, shelf, lantern, books and chair across discovery, rematch and research. Tau retains his golden shell and garden irrigation setting. Horus retains his watchtower and courtyard setting. Each opponent has three scenes and the approved fixed story.

Game imagery uses faceted cut-corner units, stepped commanders with horizontal windows, and stepped supply arches. Supply markers occupy corner squares, never interior squares. These are narrative scenes, not legal-position diagrams or substitutes for the actual board renderer.

Friend is represented by hands only. The compact Start illustration retains the red/blue hand treatment. The larger introduction shows an invitation through an open palm, board, mugs and place settings. No full human figures or animal characters appear in Friend artwork. Animals remain exclusive to computer opponents. The earlier chair invitation is a preserved exploratory direction, not a runtime asset.

## Final prompt set and processing

The built-in edits preserve character identities, story actions and composition while replacing fuzzy boundaries with crisp architectural or garden edges and continuous ivory. Board edits reference the actual `apps/web/piece-symbols.js` shapes and explicitly require corner supply arches. Babs's wooden tabletop was replaced with ivory linen so its bottom edge meets the card naturally. Friend expands the approved faceted red/blue hands into a tabletop invitation, using the same piece references.

The final generated files were inspected before encoding. Only resizing and WebP encoding followed generation (`cwebp -q 90 -resize 1200 800`), with no synthetic fades or retouching. Tau's gardening scene has no gameplay and retains its clean transparent negative space. Friend also uses clean transparency. All revised scenes use clean transparent negative space so the actual card texture continues between crisp scene elements. No blend mode approximates the surface color. Inspect every future revision in the actual component at mobile and desktop sizes, including transitions, before accepting it.

Load the first image eagerly and defer subsequent scenes. A failed image must leave the story and controls usable. Artwork does not establish trained-computer readiness.


## October 7 follow-up

Friend's compact and full illustrations now use complete foreground silhouettes. Sleeves end at deliberate angles inside the scene, and cups, plates and plants remain inside the frame. True alpha reveals the actual textured card between objects. No CSS fade, blend mode, halo or clipped prop disguises an image boundary.

Built-in generation edited the existing Friend assets. Full-scene prompt: preserve the faceted hands/tabletop invitation, extend cropped props and sleeves into complete angular silhouettes, use clean transparent negative space, keep red and blue supply arches on opposite corner squares, retain windowed commanders and octagonal pieces, and use no faces, animals, text, blur or feathering. Final corrective prompt: remove all colored background and shadows, preserve foreground objects, complete truncated sleeve and napkin ends, and output crisp true alpha with margin around the whole composition. Generation `2e5a3015-7164-4182-b516-aaf14719c5d8` is the delivered full scene. Generation `d32dbb90-ee46-48cd-b00f-5e32e0aa800b` is the delivered compact hands illustration. The compact prompt is recorded in `portrait-prompts.json`.

Delivery conversion only resizes the compact illustration to 480 pixels wide and encodes WebP at quality 90. Alpha is preserved. Both assets were inspected in the real component, since transparent pixels may retain irrelevant RGB values in image-generation previews.
