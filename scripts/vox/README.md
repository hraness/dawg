# Sung hook generator

`songs.py` writes the four studio vocal books (`soft-reboot-vox`, `low-battery-vox`, `glass-garden-vox`, `redline-vox`) the hyperpop demos sing and chop; `phrases.py` writes the three earlier sung hooks (`stay-tonight`, `lights-out`, `all-i-need`). `sing.py` does the singing:

1. [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0) speaks the original lyric with word timestamps.
2. The WORLD vocoder (pyworld) analyses it and splits each word into syllables at energy valleys.
3. Each vowel is stretched to its note length, with onset consonants placed just before the beat. Its pitch is hard-tuned to the note: a 30 ms glide, plus an optional scoop, fall and vibrato. An optional formant shift and a "clarity" exponent (less breath on voiced frames) can be applied.
4. The result is written as 24 kHz mono PCM16 at about -6 dBFS peak.

No person was recorded and no existing song is used. The lyrics and melodies are original.

```sh
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python kokoro==0.9.4 misaki==0.9.4 pyworld==0.3.5 soundfile numpy \
  'setuptools<81' spacy==3.8.7 preshed==3.0.9 murmurhash==1.0.12 cymem==2.0.10
uv pip install --python .venv/bin/python \
  https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
.venv/bin/python -I scripts/vox/phrases.py /tmp/vox
```

The first run downloads the Kokoro weights and voice packs from Hugging Face. Torch inference is not bit-exact across machines, so a regenerated file will not match the checked-in hashes. The hash-pinned WAVs in `assets/samples/studio/` are the canonical distribution. `phrases.py` prints, and saves as `slices.json`, the slice table that `core/bundled-samples.ts` reproduces with `hookSlices()`. `songs.py <outdir> [id...]` renders each line, syllable and held vowel separately at its song's tempo, joins them and saves the named slices as `slices.json`; `core/bundled-samples.ts` lists those slices verbatim.

The extra pins avoid three install traps: pyworld still imports `pkg_resources` (gone in setuptools 81), misaki cannot download its spaCy model into a uv venv, and preshed 3.0.10+ overflows in spaCy's tokenizer on macOS arm64.

## Chart books

`songs.py --spec song.json out.wav` renders one book from a JSON spec (`{voice, bpm, formant, parts: [[name, beats, notes]]}`) and prints its slice table. `bun scripts/vox/chart-book.ts chart.json <out dir> [--voice af_bella] [--python .venv/bin/python]` writes that spec for a `dawg make` chart: every distinct line the performer places (named `l_<hash>` from its notes), chops on the chart's most-used one-syllable hook words plus "oh" and "yeah", and a held "ooh". It renders the book and writes `<id>.book.json`, the `VoxBank` that `performChart(chart, book)` takes, with the `core/bundled-samples.ts` entry to register. With a book, the performer adds the sung lead, its double, the chop bank, a vocal-synth double of the hook and a grain bed, and pulls the synth vocal under them.

## Other speakers

A `sing.py` spec can take `"speech": "take.wav"` instead of Kokoro: a recording of the line from another local TTS engine. whisper.cpp (`whisper-cli`, model from `$WHISPER_MODEL`, default `~/.cache/dawg/whisper/ggml-small.en.bin`) finds the word times, and WORLD retunes it exactly as it does Kokoro. Only synthetic voices described in text, or the user's own consented voice, go in. Never clone or imitate a real singer.
