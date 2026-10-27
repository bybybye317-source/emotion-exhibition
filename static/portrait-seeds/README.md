# Fictional portrait seeds

`fictional-faces.png` contains 20 AI-generated fictional adult portraits. These are visual seed materials for the composite face, **not real exhibition visitors, camera captures, participant records, or emotion measurements**. They must not contribute to visitor counts or group emotion statistics. Real visitor fragments may gradually replace them.

## Source

- Created on 2026-10-27 using Codex's built-in image generation tool.
- The parent task prepared the portrait request using the `lira-image-prompts` skill before generation.
- Original generation artifact: `exec-180f5244-0836-440d-8647-174501a9163a.png` in generation session `01a16295-7ecf-72d1-87b8-7307ef4e66ce`.
- Bundled image: 1402 × 1122 pixels, 5 columns × 4 rows, 20 portraits.
- SHA-256: `898c3a7465bc2be0f83e1979d34d036759b0d1679ef905465e75d400a2cfe5a2`.
- No real-person reference photographs or private camera material were used in this asset or its manifest.

### Generation prompt

> A precisely aligned photographic contact sheet containing twenty separate fictional adult portrait photographs, arranged in exactly five equal columns and four equal rows, filling the entire rectangular image edge to edge. Each identical rectangular tile contains exactly one different adult's full face, tightly cropped from the top of the forehead to just below the chin; ears fit inside the tile. Every person faces straight toward the camera at eye level, with level eyes, a relaxed closed mouth and a neutral expression. The faces are diverse in skin tone, facial structure, gender presentation and adult age, from young adults to older people. Natural skin texture, individual eyebrows and lips, simple hair. Uniform soft frontal studio light with gentle side modelling, plain charcoal background. Consistent face scale and eye and mouth height in all twenty tiles. Clean documentary photography, crisp detail, restrained natural colours. Each photograph occupies its whole tile with no gaps, borders, captions or decorative elements.

## Manifest preparation

`manifest.json` lists portraits in row-major order, from `seed-01` to `seed-20`. Its `rect` values are `[x, y, width, height]` in source-image pixels. Tile boundaries are rounded independently from the actual atlas dimensions, so the rectangles cover the atlas without gaps or overlap even though its dimensions are not evenly divisible by 5 and 4.

Each tile was cropped with browser `createImageBitmap` and processed locally using the project's bundled MediaPipe FaceLandmarker (`face_landmarker.task`, CPU delegate, image mode, maximum 2 faces, detection and presence confidence thresholds 0.5). Exactly one face was detected in each of all 20 tiles. The existing `alignmentAnchors` function in `static/browser-inference.mjs` produced `photo_anchors`; each coordinate is normalized to its individual tile, rather than to the atlas. All stored coordinates were checked to be finite and within `[0, 1]`.

The manifest contains geometry only. There are no emotion scores, identities, participant timestamps, or fabricated observation records. Analysis used a temporary headless browser on the local asset server; it did not access a camera.

On 2026-10-28 the existing atlas was reprocessed with the same local analyzer to retain 14 additional eye-corner, eyelid and eyebrow anchors for the anatomical collage. All 20 tiles passed one-face detection. The image bytes and SHA-256 remain unchanged; only geometric metadata was extended.
