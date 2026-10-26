# Real orchestral samples for the emotion Demo

This folder contains a small, locally playable subset of **VSCO 2 Community
Edition**, recorded by **Sam Gossner and Simon Dalzell**, with sample cutting by
**Elan Hickler / Soundemote**, from **Versilian Studios / Ivy Audio**.

These are acoustic recordings of violin and cello sections, F horn and tenor
trombone. They replace the synthetic strings and brass; the separate synth,
sub-bass and percussion engines remain procedural.

## Source and permission

- Official library page: <https://versilian-studios.com/vsco-community/>
- Upstream repository: <https://github.com/sgossner/VSCO-2-CE>
- Pinned SFZ branch commit: `6dd651d55dde97fd4028699be9d4481f26917891`.
- Source license: **CC0 1.0 Universal**, copied verbatim into
  [`LICENSE-VSCO-2-CE.txt`](LICENSE-VSCO-2-CE.txt).
- Original instrument maps and recording credits are preserved in `provenance/`.
- Every processed file's SHA-256, exact pinned source URL, source SHA-256 and
  source byte count are recorded in [`manifest.json`](manifest.json).

## Shipped selection

| Instrument key | Acoustic source | MIDI roots | Dynamic recordings | Files |
| --- | --- | --- | --- | --- |
| `violin` | Violin Section, sustain vibrato | 62, 66, 69, 72, 76, 79 | v1 / v2 | 12 |
| `cello` | Cello Section, sustain vibrato | 47, 50, 53, 57, 60 | v1 / v3 | 10 |
| `horn` | F Horn, sustain | 46, 50, 53, 57, 60 | v1 / highest available v3 or v4 | 10 |
| `trombone` | Tenor Trombone, sustain | 50, 53, 60 | v1 / v3 | 6 |

There are **38 stereo 44.1 kHz, 16-bit PCM WAVs**, totaling **38,033,512 bytes**
(36.27 MiB). Only the selected source recordings were fetched: **85,601,840 bytes**
(81.64 MiB), without downloading the complete multi-gigabyte library. WAV is used
for consistent local decoding and clean loop sample boundaries.

MIDI root notes come from the original SFZ maps, not filename octave conventions.
The score stays within three semitones of a sampled pitch. In particular the
upstream horn has a large gap above MIDI 60, so the Demo keeps this horn register
at MIDI 62 or below instead of stretching it into a different instrument.

## Loop and level preparation

The source recordings and SFZ regions contain no sustain-loop markers. The
preparation script **derives** them; it does not claim these are author-supplied
loops. It measures the 50 ms RMS envelope after the natural attack, searches
3.2–4.4 second sustain windows for low level variation and similar end levels,
and avoids the natural release. The final 400 ms is cosine-crossfaded into the
400 ms preceding the selected loop start. Consequently the loop wrap joins two
adjacent samples from the recording, with a verified two-LSB rounding tolerance.
The playable loops are 2.8–4.0 seconds long and retain natural bow/breath motion.

The attack is retained with a 6 ms de-click fade. Stable RMS is calibrated to
0.10 for the softer recording and 0.14 for the stronger recording, with a 0.85
peak ceiling. This preserves different recorded timbres and a 1.4× source-level
contrast while giving the engine predictable headroom. The original recordings
have unequal recording levels; `normalizationGain` documents each adjustment.
The runtime applies its additional note envelope, emotional dynamics, orchestral
layer balance and hall reverb. It must not interpret these waveform peak values
as safe combined mix levels.

[`provenance/validation.json`](provenance/validation.json) verifies all installed
SHA-256 values, PCM decoding, valid loop spans, seam continuity, finite samples,
peak levels and pitched harmonic energy. Harmonic energy exceeds 93% for every
prepared sustain, confirming that even very quiet brass sources are normalized
pitched recordings rather than a noise-only window. This is objective signal QA,
not a claim that a human auditioned the samples.

## Manifest contract

`instruments` contains `violin`, `cello`, `horn` and `trombone` arrays. Each entry
includes `url`, `midi`, `velocity` (0.35 / 0.8), `dynamic`, `gain` (1),
`loopStartSeconds`, `loopEndSeconds`, `sampleRate`, `channels`, `rms`, `peak`,
`bytes`, `sha256` and `source` provenance. The runtime chooses the nearest
instrument pitch and recorded dynamic; `playbackRate = 2 ** ((note - midi) / 12)`.

From the project directory:

```bash
.venv/bin/python scripts/prepare_orchestra_samples.py --verify
.venv/bin/python scripts/prepare_orchestra_samples.py
```

The second command rebuilds deterministically from the pinned source, caching
original downloads under `/tmp/emotion-vsco-recordings` by default. It needs NumPy,
already present in the Demo's Python environment. No downloads occur at runtime.
