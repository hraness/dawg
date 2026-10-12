# Studio v1

Eight small original DAWG sounds, available offline. The voice files are synthetic formant singing, not recordings of a person. No third-party audio, song melody, lyrics beyond the ordinary two-word phrases, or trained voice model is included.

| ID        | Source                                            | Root       | Length | Use                   |
| --------- | ------------------------------------------------- | ---------- | ------ | --------------------- |
| hold-on   | DAWG alto articulate voice: “hold on hold on”     | C4         | 2s     | Garage chops          |
| stay-up   | DAWG tenor articulate voice: “stay up stay up”    | C4         | 2s     | Pop/electro chops     |
| vowel-ah  | DAWG alto articulate voice: “ah”                  | C4         | 1s     | Chords and pads       |
| vowel-oh  | DAWG tenor articulate voice: “oh”                 | C4         | 1s     | Chords and pads       |
| glass-hit | Additive struck partials with seeded noise attack | C6         | 0.8s   | Bright percussion     |
| metal-hit | Additive inharmonic partials with seeded noise    | C5         | 0.8s   | Industrial percussion |
| tape-hit  | Saturated pitch-drop sine and seeded noise        | nominal C4 | 0.45s  | Thumps and fills      |
| riser     | Rising sine and seeded noise                      | nominal C4 | 2s     | Transition sweep      |

All files: mono PCM16 WAV, 24 kHz, -6 dB peak, faded file boundaries. The four phrase syllables occupy exact quarter-file regions (0–0.25, 0.25–0.5, 0.5–0.75, 0.75–1), each with a short release gap. They are one bar at 120 BPM. Hits and sweeps have nominal sampler roots where no single fundamental applies.

Regenerate from the repository root with `bun scripts/generate-studio-samples.ts`. That source records every voice parameter, oscillator formula, seed, fade and normalization step. `manifest.json` records each file's SHA-256, byte length and duration. The checked-in metadata in `core/bundled-samples.ts` pins the same hashes; changing a published sound requires a new library version and URL namespace rather than silently replacing studio-v1 bytes. Small floating-point library differences can affect regenerated least-significant PCM bits; the checked-in, hash-verified WAVs are the canonical distribution.

`https://dawg.sh/bundled/studio-v1/` is an internal versioned asset identity. DAWG resolves these exact catalogued URLs from its installed package before considering caches or network access. It never fetches missing or unknown assets from that namespace. Packaging must include `assets/samples/**` alongside source modules. No network, speech executable, sample download or account is required.

The WAV files are dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). To the extent possible under law, the DAWG contributors waive copyright and related rights in these original generated sample recordings. No attribution is required. The generator and runtime code remain under the repository's code license.

Manual: `/sample library vocal`, `/sample use hold-on`, `/sample chop hold-on 4`. Agent: `list_packs {pack:"studio"}` returns the metadata and pinned references; `search_sounds {pack:"studio",query:"vocal"}` narrows it; `use_sound {sound:"studio/hold-on"}` loads it. The shared `audio` tool also accepts `input:"pack:studio/hold-on"`; `op:"slice", method:"grid", count:4, track:"chops", pattern:true` creates playable slices in one score revision. Originals are never edited.
