# Collective sculpture head

This is a **derived, subdivided version of the author's MIT-licensed example
mask** from [FaceCapCustomAvatarExporter](https://github.com/hizzlehoff/FaceCapCustomAvatarExporter).
It is not the differently sourced `facecap.glb` distributed with Three.js.

## Source and license

- Author: Niels J. / Face Cap.
- Pinned source commit: `86a89d247624e7b5e393e4336709e490db717382`.
- Original data: [`Examples/Example.FCA`](https://raw.githubusercontent.com/hizzlehoff/FaceCapCustomAvatarExporter/86a89d247624e7b5e393e4336709e490db717382/Examples/Example.FCA).
- Original author's [documentation](https://www.bannaflak.com/face-cap/importavatar.html)
  links directly to that repository for its scripts and sample files.
- [Original MIT license](https://raw.githubusercontent.com/hizzlehoff/FaceCapCustomAvatarExporter/86a89d247624e7b5e393e4336709e490db717382/LICENSE):
  Copyright (c) 2020 Niels J. A verbatim copy is included in
  `sculpture-head-LICENSE.txt`. Retain that notice with redistribution.

## Changes

- Converted source geometry and 43 expression states (the eight unused eye-gaze channels are omitted) to glTF 2.0.
- Applied two identical Loop subdivision passes to the face and each expression;
  one pass to each of the separate eyes. No invented ellipsoid facial surface.
- Recomputed normals for every expression so light follows facial movement.
- Stored sparse position and normal deltas. Normal changes below `0.00001` are
  omitted; position changes below `0.0000001` are omitted.
- Normalized to +Y up and +Z front, with final face-mask Y bounds `[-1.2, 1.2]`.
- Left the author's open mask boundary intact. This asset is intentionally a
  face mask, not a complete back of head or bust.
- Omitted the source texture; the exhibition supplies a sculpture material and
  projects participants' photographs onto the front surface.
- Added front-projection landmark metadata in `scenes[0].extras` and
  `asset.extras.portrait`. The accompanying metadata JSON includes source/output
  SHA-256 checksums, bounds, vertex counts and target names. Six lip anchors
  use refined positions of original source vertices; the mouth center is the
  midpoint of the upper/lower inner lip sheets, allowing photographed smiles
  to fit the narrow neutral mouth without stretching teeth down the chin.

## Runtime integration

Mesh names: `SculptureHead`, `EyeLeft`, `EyeRight`.
`SculptureHead` has 43 named morph targets, including all expression channels
used by the exhibition. `EyeLeft` is the character's left (viewer right).
`landmarks.left_eye` is viewer left, matching the image-alignment pipeline.
All three meshes use the same calibrated front projection for audience photos,
so photographed eyes remain aligned with the face instead of being doubled by
separate rendered eye details. Before photos arrive, the eye material supplies a
subdued stone iris. The planar UV is only a convenience; use the metadata
landmarks and bounds when calibrating the final photo projection.

## Rebuild

From the repository root, run `python3 scripts/build-sculpture-head.py` with
NumPy installed. The build downloads the two pinned data/license files, executes
no upstream scripts, and writes the GLB, metadata and license files in this
folder. The output is deterministic for the same Python/NumPy arithmetic.
