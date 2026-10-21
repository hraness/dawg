# Sung hook generator

`songs.py` writes the four studio vocal books (`soft-reboot-vox`, `low-battery-vox`, `glass-garden-vox`, `redline-vox`) the hyperpop demos sing and chop; `phrases.py` writes the three earlier sung hooks (`stay-tonight`, `lights-out`, `all-i-need`). `sing.py` does the singing:

1. [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) speaks the original lyric with word timestamps.
2. The WORLD vocoder (pyworld) analyses it and splits each word into syllables at energy valleys.
3. Each vowel is stretched to its note length, with onset consonants placed just before the beat. Its pitch is hard-tuned to the note: a 30 ms glide, plus an optional scoop, fall and vibrato. An optional formant shift and a "clarity" exponent (less breath on voiced frames) can be applied.
4. The result is written as 24 kHz mono PCM16 at about -6 dBFS peak.

No person was recorded and no existing song is used. The lyrics and melodies are original.

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python kokoro==0.9.4 misaki==0.9.4 pyworld==0.3.5 soundfile numpy
.venv/bin/python -I scripts/vox/phrases.py /tmp/vox
```

The first run downloads the Kokoro weights and voice packs from Hugging Face. Torch inference is not bit-exact across machines, so a regenerated file will not match the checked-in hashes. The hash-pinned WAVs in `assets/samples/studio/` are the canonical distribution. `phrases.py` prints, and saves as `slices.json`, the slice table that `core/bundled-samples.ts` reproduces with `hookSlices()`. `songs.py <outdir> [id...]` renders each line, syllable and held vowel separately at its song's tempo, joins them and saves the named slices as `slices.json`; `core/bundled-samples.ts` lists those slices verbatim.
