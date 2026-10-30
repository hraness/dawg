# Local stock vocal backend

The installed helper adapts the contributor Kokoro + WORLD pipeline. It sings
only the stock British `bf_emma` voice. It accepts lyric/note specifications,
never a recording or speaker identity. It does not register public samples.

`discoverVocalBackend()` checks `DAWG_VOCAL_PYTHON`, or the managed environment at
`~/.cache/dawg/vocals/python/bin/python`. `DAWG_VOCAL_CACHE` changes the managed
environment's parent. `DAWG_VOCAL_MODEL_CACHE` selects a Hugging Face hub cache.
`vocalBackendSetup()` prints commands for an explicit setup. No discovery,
generation, accepted-take reuse or saved-song playback installs dependencies.

Use Python 3.12 and the adjacent `requirements.txt`. Kokoro/misaki/WORLD use the
proven contributor versions. The spaCy C-extension pins retain the macOS arm64
tokenizer workaround, and setuptools stays below 81 because pyworld imports
`pkg_resources`. English `en_core_web_sm` is installed explicitly to avoid an
implicit spaCy model download. An existing compatible environment can be selected;
the accepted take records its actual package versions.

Run `python -I book.py --download-models` explicitly once after installing the
requirements. This fetches only Kokoro-82M revision
`f3ff3571791e39611d31c381e3a41a3af07b4987`'s config, weights and `bf_emma` voice.
The helper verifies SHA-256 for all three. `python -I book.py --probe` checks
dependencies and local cached identities without inference or network access.
Normal generation always uses `local_files_only=True` and `HF_HUB_OFFLINE=1`.

The bridge validates bounded input and project write scope, stages a complete
24 kHz mono PCM16 book, then atomically accepts its WAV, spec, book and provenance
as one immutable directory under `tracks/<track>/samples/vocals/`. A cancelled
run removes its staging directory; completed takes stay intact. Identical input
and helper/model identities reuse verified accepted audio without Python.
Fresh Torch inference is not promised to be byte-identical across machines.

Ship `book.py`, `sing.py` and `requirements.txt` together with the TypeScript
bridge. They resolve relative to the installed package, with no checkout or
contributor-home dependency. The helper starts one process and no child processes.
