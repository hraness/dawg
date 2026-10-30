"""Installed stock-vocal helper. Model download is an explicit separate action.

Normal generation is strictly local-cache-only. A single process owns Kokoro,
WORLD and all parts so cancellation cannot leave a singing child behind.
"""
import argparse
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import sys

# An installed package may be read-only; the helper owns project staging only.
sys.dont_write_bytecode = True

REPOSITORY = "hexgrad/Kokoro-82M"
REVISION = "f3ff3571791e39611d31c381e3a41a3af07b4987"
MODEL_FILES = {
    "config": ("config.json", "5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f"),
    "weights": ("kokoro-v1_0.pth", "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4"),
    "voice": ("voices/bf_emma.pt", "d0a423deabf4a52b4f49318c51742c54e21bb89bbbe9a12141e7758ddb5da701"),
}
DEPENDENCIES = [
    "kokoro", "misaki", "pyworld", "numpy", "soundfile", "torch",
    "huggingface-hub", "setuptools", "spacy", "preshed", "murmurhash", "cymem", "en_core_web_sm",
]


def identities(download=False):
    dependencies = {}
    for name in DEPENDENCIES:
        try:
            dependencies[name.replace("-", "_")] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            raise ValueError(f"Missing Python dependency {name}; install the bundled requirements.txt")
    for name, version in [("kokoro", "0.9.4"), ("misaki", "0.9.4"), ("pyworld", "0.3.5")]:
        if dependencies[name] != version:
            raise ValueError(f"{name}=={version} is required; this Python has {dependencies[name]}")
    if not dependencies["setuptools"].split(".")[0].isdigit() or int(dependencies["setuptools"].split(".")[0]) >= 81:
        raise ValueError("pyworld needs setuptools<81 (pkg_resources); install the bundled requirements.txt")
    if dependencies["en_core_web_sm"] != "3.8.0":
        raise ValueError("The installed English model must be en_core_web_sm==3.8.0")
    from huggingface_hub import hf_hub_download
    paths, files = {}, {}
    for key, (filename, expected) in MODEL_FILES.items():
        try:
            path = hf_hub_download(
                repo_id=REPOSITORY, filename=filename, revision=REVISION,
                local_files_only=not download,
            )
        except Exception:
            raise ValueError(f"Pinned Kokoro file {filename} is not cached. Run this helper with --download-models explicitly before generation") from None
        digest = hashlib.sha256()
        with open(path, "rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != expected:
            raise ValueError(f"Pinned Kokoro file {filename} has changed; preserve it and repair the model cache")
        paths[key] = path
        files[key] = digest.hexdigest()
    return paths, {
        "python": platform.python_version(),
        "dependencies": dependencies,
        "model": {"repository": REPOSITORY, "revision": REVISION, "files": files},
    }


def render(spec_path, output_path):
    # The TypeScript bridge is the public parser; repeat the important resource
    # and path-free input caps here for direct helper use.
    path = Path(spec_path)
    if path.stat().st_size > 512 * 1024:
        raise ValueError("Vocal spec exceeds 512 KiB")
    spec = json.loads(path.read_text())
    if not isinstance(spec, dict) or spec.get("voice") != "bf_emma":
        raise ValueError("Only the stock bf_emma voice is supported")
    allowed = {"voice", "bpm", "root", "lead", "formant", "clarity", "speed", "human", "seed", "parts", "syllables", "lines", "heads"}
    if set(spec) - allowed:
        raise ValueError("Unsupported vocal spec fields")
    parts = spec.get("parts")
    if not isinstance(parts, list) or not 1 <= len(parts) <= 128:
        raise ValueError("Vocal books need 1 to 128 parts")
    bpm = spec.get("bpm")
    lead = spec.get("lead", 0.25)
    if not isinstance(bpm, (int, float)) or not 40 <= bpm <= 240 or not isinstance(lead, (int, float)) or not 0.08 <= lead <= 1:
        raise ValueError("Invalid vocal tempo or lead-in")
    beats = 0
    note_count = 0
    names = set()
    for part in parts:
        if not isinstance(part, list) or len(part) not in (3, 4) or not isinstance(part[1], (int, float)) or not 0.125 <= part[1] <= 128:
            raise ValueError("Invalid vocal part")
        if not isinstance(part[2], list) or not 1 <= len(part[2]) <= 256:
            raise ValueError("Invalid vocal part notes")
        if len(part) == 4 and (not isinstance(part[3], dict) or set(part[3]) - {"formant", "clarity", "speed", "human", "seed"}):
            raise ValueError("Only vocal settings can be overridden per part")
        if not isinstance(part[0], str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", part[0]) or part[0] in names:
            raise ValueError("Vocal part names must be unique bounded names")
        names.add(part[0])
        previous = -1
        last_syllable = ""
        for note in part[2]:
            if not isinstance(note, dict) or set(note) - {"syl", "beat", "len", "midi", "scoop", "fall", "glide", "vib", "dyn", "air", "gap", "legato"}:
                raise ValueError("Unsupported vocal note fields")
            syllable = note.get("syl")
            if not isinstance(syllable, str) or len(syllable) > 48 or not re.fullmatch(r"(?:[A-Za-z]+(?:'[A-Za-z]+)*-?|~)", syllable):
                raise ValueError("Invalid vocal syllable")
            if syllable == "~" and (not last_syllable or last_syllable.endswith("-")):
                raise ValueError("A held vowel needs a completed syllable")
            for key, low, high in [("beat", 0, part[1]), ("len", 0.03, part[1]), ("midi", 24, 108)]:
                if not isinstance(note.get(key), (int, float)) or not low <= note[key] <= high:
                    raise ValueError(f"Invalid vocal note {key}")
            if note["beat"] <= previous or note["beat"] + note["len"] > part[1] + 1e-6:
                raise ValueError("Vocal note timing exceeds the part")
            for key, low, high in [("scoop", -12, 12), ("fall", -12, 12), ("glide", 0, 1), ("vib", 0, 2), ("dyn", 0.05, 1.5), ("air", 0, 1), ("gap", 0, 0.5)]:
                if key in note and (not isinstance(note[key], (int, float)) or not low <= note[key] <= high):
                    raise ValueError(f"Invalid vocal note {key}")
            previous, last_syllable = note["beat"], syllable
        if last_syllable.endswith("-"):
            raise ValueError("A vocal part cannot end with an unfinished word")
        beats += part[1] + lead
        note_count += len(part[2])
    if beats * 60 / bpm > 600 or note_count > 4096:
        raise ValueError("Vocal book exceeds the 600 second or 4096 note budget")
    paths, provenance = identities()
    # -I intentionally omits the script directory from sys.path. Load only
    # the sibling shipped module by its absolute package resource path.
    module_spec = importlib.util.spec_from_file_location("dawg_stock_sing", Path(__file__).with_name("sing.py"))
    sing = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(sing)
    import numpy as np
    import soundfile as sf
    sing.configure(paths)
    chunks, slices, cursor = [], [], 0
    settings = {key: spec[key] for key in ["formant", "clarity", "speed", "human", "seed"] if key in spec}
    total = sum(round((part[1] + lead) * 60 / bpm * 24000) for part in parts)
    for index, (name, beats, notes, *overrides) in enumerate(parts):
        part_spec = {
            **settings, "voice": "bf_emma", "bpm": bpm, "bars": beats / 4,
            "lead": lead, "notes": notes, "seed": spec.get("seed", 0) + index,
            **(overrides[0] if overrides else {}),
        }
        print("DAWG_VOCAL_PROGRESS " + json.dumps({"stage": "sing", "part": name, "completed": index, "total": len(parts)}), file=sys.stderr, flush=True)
        audio = sing.render(part_spec)
        count = round((beats + lead) * 60 / bpm * 24000)
        audio = audio[:count] if len(audio) >= count else np.pad(audio, (0, count - len(audio)))
        chunks.append(audio)
        slices.append({"name": name, "begin": round(cursor / total, 6), "end": round((cursor + count) / total, 6)})
        cursor += count
    audio = np.concatenate(chunks)
    if not np.isfinite(audio).all() or np.max(np.abs(audio)) < 1e-8:
        raise ValueError("The vocal backend produced silent or invalid audio")
    audio *= 0.49 / (np.max(np.abs(audio)) + 1e-9)
    # The bridge supplies a fresh private staging directory. Never overwrite
    # any file when this helper is invoked directly either.
    with open(output_path, "xb") as stream:
        sf.write(stream, audio.astype(np.float32), 24000, subtype="PCM_16", format="WAV")
    return {"seconds": round(total / 24000, 6), "slices": slices, "provenance": provenance}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true")
    group.add_argument("--download-models", action="store_true")
    group.add_argument("--spec", nargs=2, metavar=("SPEC", "OUTPUT"))
    args = parser.parse_args()
    if not args.download_models:
        os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    try:
        # Library diagnostics belong on bounded stderr; stdout is one JSON value.
        with contextlib.redirect_stdout(sys.stderr):
            if args.spec:
                result = render(*args.spec)
            else:
                _, provenance = identities(download=args.download_models)
                result = {"available": True, "provenance": provenance}
        print(json.dumps(result), flush=True)
    except Exception as error:
        print(f"Vocal backend: {str(error)[:1200]}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
