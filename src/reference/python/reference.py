"""Portable reference controls and stock-voice resinging.

There are no song identities, reference recordings or lyric permissions here.
The source supplies pitch, coarse amplitude and alignment evidence. Synthesized
waveform samples and spectral envelopes always come from stock bf_emma.
"""
import argparse
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import re
import sys

sys.dont_write_bytecode = True
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ.setdefault("OMP_NUM_THREADS", "1")
FS, FP, FFT, HOP = 24000, 5.0, 1024, 120


def progress(text):
    print("DAWG_REFERENCE_PROGRESS " + text, file=sys.stderr, flush=True)


def dependencies():
    return {name: importlib.metadata.version(name) for name in ["numpy", "pyworld", "scipy", "soundfile"]}


def digest(path):
    result = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def read_audio(path):
    import numpy as np
    import soundfile as sf
    data, rate = sf.read(path, dtype="float64", always_2d=True)
    if rate != FS or data.shape[1] != 1 or not 0 < len(data) <= 600 * FS or not np.isfinite(data).all():
        raise ValueError("A reference must be a complete finite 24 kHz mono window of at most 600 seconds")
    return data[:, 0]


def features(sp):
    import numpy as np
    from scipy import fft
    hz = np.fft.rfftfreq(FFT, 1 / FS)
    mel = lambda frequency: 2595 * np.log10(1 + frequency / 700)
    edges = 700 * (10 ** (np.linspace(mel(120), mel(10000), 34) / 2595) - 1)
    bank = np.array([np.maximum(0, np.minimum((hz - low) / (mid - low), (high - hz) / (high - mid))) for low, mid, high in zip(edges, edges[1:], edges[2:])])
    return fft.dct(np.log(np.maximum(sp @ bank.T, 1e-12)), type=2, axis=1, norm="ortho")[:, 1:17]


def analyze(reference, controls_path, analysis_path, config_path):
    import numpy as np
    import pyworld as pw
    from scipy import ndimage
    if Path(controls_path).exists() or Path(analysis_path).exists():
        raise ValueError("Reference analysis never overwrites existing artifacts")
    if Path(controls_path).parent != Path(analysis_path).parent or Path(config_path).parent != Path(analysis_path).parent:
        raise ValueError("Reference analysis outputs must share their owned staging directory")
    config = json.loads(Path(config_path).read_text())
    bpm = float(config["bpm"])
    if not 40 <= bpm <= 300:
        raise ValueError("Unsupported reference tempo")
    y = read_audio(reference)
    progress("extracting continuous source pitch and dynamics")
    f0, times = pw.harvest(y, FS, f0_floor=65, f0_ceil=1100, frame_period=FP)
    f0 = pw.stonemask(y, f0, times, FS)
    sp = pw.cheaptrick(y, f0, times, FS, fft_size=FFT)
    spectrum = features(sp).astype(np.float32)
    del sp
    rms = np.sqrt(np.maximum(ndimage.uniform_filter1d(y * y, int(FS * 0.02)), 1e-12))
    frame_rms = rms[np.minimum((times * FS).astype(int), len(y) - 1)]
    np.savez_compressed(controls_path, f0=f0, times=times, features=spectrum, rms=frame_rms, duration=np.array(len(y) / FS), source_hash=np.array(digest(reference)))
    midi = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1) / 440), -1)
    quantized = np.where(f0 > 0, np.rint(ndimage.median_filter(midi, size=5)), -1)
    notes, first = [], 0
    energy_max = max(float(np.max(frame_rms)), 1e-6)
    for index in range(1, len(f0) + 1):
        if index < len(f0) and quantized[index] == quantized[first]:
            continue
        if quantized[first] >= 0 and (index - first) * FP / 1000 >= 0.055:
            pitch = float(quantized[first])
            notes.append({"startSeconds": round(first * FP / 1000, 5), "endSeconds": round(min(len(y) / FS, index * FP / 1000), 5), "pitch": int(pitch), "velocity": float(np.clip(np.mean(frame_rms[first:index]) / energy_max, 0.08, 1)), "confidence": float(np.mean(np.abs(midi[first:index] - pitch) < 0.5))})
        first = index
    if len(notes) > 4096:
        raise ValueError("Reference melody exceeds 4096 notes; prepare a shorter section")
    blocks = []
    seconds_per_block = 16 * 60 / bpm
    for start in np.arange(0, len(y) / FS, seconds_per_block):
        end = min(start + seconds_per_block, len(y) / FS)
        a, z = int(start * 1000 / FP), min(len(f0), max(int(end * 1000 / FP), int(start * 1000 / FP) + 1))
        voiced = midi[a:z] >= 0
        chroma = np.zeros(12)
        if voiced.any():
            chroma = np.bincount(np.rint(midi[a:z][voiced]).astype(int) % 12, weights=frame_rms[a:z][voiced], minlength=12)
            chroma /= max(float(chroma.sum()), 1e-8)
        blocks.append({"start": float(start), "end": float(end), "features": [float(np.clip(np.mean(frame_rms[a:z]) / energy_max, 0, 1)), float(np.mean(voiced)), *chroma.tolist()]})
    analysis = {"duration": len(y) / FS, "sampleRate": FS, "frames": len(y), "notes": notes, "blocks": blocks, "voicedSeconds": float(np.sum(f0 > 0) * FP / 1000), "provenance": {"python": platform.python_version(), "dependencies": dependencies()}, "limitations": "WORLD monophonic pitch and coarse form estimates; notes, beat phase and section labels require review"}
    with open(analysis_path, "x") as stream:
        json.dump(analysis, stream)
    return {"analyzed": True, "frames": len(y), "notes": len(notes)}


def load_stock():
    source = Path(__file__).resolve().parents[2] / "vocals" / "python"
    def module(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        value = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(value)
        return value
    book = module("dawg_stock_book", source / "book.py")
    paths, provenance = book.identities()
    sing = module("dawg_reference_stock_sing", source / "sing.py")
    sing.configure(paths)
    return sing, provenance


def words(text):
    return re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower().replace("’", "'"))


def token_spans(expected, tokens):
    import numpy as np
    letters, starts, ends = "", [], []
    for text, a, b in tokens:
        text = text.replace("'", "")
        for index in range(len(text)):
            starts.append(a + (b - a) * index / len(text))
            ends.append(a + (b - a) * (index + 1) / len(text))
        letters += text
    result, position = [], 0
    for word in expected:
        target = word.replace("'", "")
        at = letters.find(target, position)
        if at < 0:
            raise ValueError("Stock TTS token alignment failed; verify the supplied lyric spelling")
        result.append((starts[at], ends[at + len(target) - 1]))
        position = at + len(target)
    return np.array(result)


def align(source_features, tts_features, expected):
    """Bounded 20 ms spectral DTW with chronological word-center anchors."""
    import numpy as np
    stride = 4
    a, b = source_features[::stride].copy(), tts_features[::stride].copy()
    if len(a) < 2 or len(b) < 2 or len(a) * len(b) > 2250000:
        raise ValueError("A phonetic alignment window exceeded its frame budget; use lyric lines under 20 seconds")
    a = (a - np.median(a, axis=0)) / (np.std(a, axis=0) + 2)
    b = (b - np.median(b, axis=0)) / (np.std(b, axis=0) + 2)
    cost = np.maximum(0, np.mean(a * a, axis=1)[:, None] + np.mean(b * b, axis=1)[None, :] - 2 * a @ b.T / a.shape[1])
    expected_small = expected[::stride] / stride
    expected_small[0], expected_small[-1] = 0, len(b) - 1
    distance = (np.arange(len(b))[None, :] - expected_small[:, None]) * FP * stride / 1000
    cost += 0.6 * (distance / 0.35) ** 2
    acc = np.full((len(a), len(b)), np.inf)
    predecessor = np.full((len(a), len(b)), 255, dtype=np.uint8)
    band = 60
    for row in range(len(a)):
        low, high = max(0, int(expected_small[row]) - band), min(len(b), int(expected_small[row]) + band + 1)
        if row == 0:
            low = 0
        if row == len(a) - 1:
            high = len(b)
        for column in range(low, high):
            if row == 0 and column == 0:
                acc[row, column] = cost[row, column]
                continue
            options = [acc[row - 1, column - 1] if row and column else np.inf, acc[row - 1, column] + cost[row, column] * 0.25 if row else np.inf, acc[row, column - 1] + cost[row, column] * 0.25 if column else np.inf]
            choice = int(np.argmin(options))
            acc[row, column] = cost[row, column] + options[choice]
            predecessor[row, column] = choice
    if not np.isfinite(acc[-1, -1]):
        raise ValueError("Word-center alignment is disconnected; correct the lyric line timing")
    groups = [[] for _ in range(len(a))]
    row, column = len(a) - 1, len(b) - 1
    while True:
        groups[row].append(column)
        if row == 0 and column == 0:
            break
        choice = predecessor[row, column]
        if choice == 0:
            row, column = row - 1, column - 1
        elif choice == 1:
            row -= 1
        elif choice == 2:
            column -= 1
        else:
            raise ValueError("Invalid phonetic alignment path")
    mapping = np.array([np.median(columns) if columns else expected_small[index] for index, columns in enumerate(groups)]) * stride
    return np.maximum.accumulate(np.interp(np.arange(len(source_features)), np.arange(len(mapping)) * stride, mapping))


def synthesize(config_path):
    import numpy as np
    import pyworld as pw
    import soundfile as sf
    from scipy import ndimage
    config = json.loads(Path(config_path).read_text())
    output = Path(config["outputDirectory"])
    if output.resolve() != Path(config_path).parent.resolve():
        raise ValueError("Reference synthesis writes only its owned configuration directory")
    if any((output / name).exists() for name in ["stock.wav", "comparison-source.wav", "comparison-stock.wav", "report.json"]):
        raise ValueError("Reference synthesis never overwrites accepted audio")
    reference = read_audio(config["reference"])
    with np.load(config["controls"], allow_pickle=False) as stored:
        ref = {key: stored[key] for key in stored.files}
    if str(ref["source_hash"]) != digest(config["reference"]):
        raise ValueError("Source audio no longer matches the recorded performance controls")
    count = len(ref["f0"])
    if count > 120001 or ref["features"].shape != (count, 16) or len(ref["rms"]) != count or any(not np.isfinite(ref[key]).all() for key in ["f0", "times", "features", "rms"]):
        raise ValueError("Invalid bounded reference controls")
    lines = config["lyrics"]
    if not isinstance(lines, list) or not 1 <= len(lines) <= 512:
        raise ValueError("Supply bounded timed actual lyrics before synthesis")
    sing, provenance = load_stock()
    out, weights = np.zeros(len(reference)), np.zeros(len(reference))
    planned = np.zeros(count, dtype=bool)
    reports, cache = [], {}
    for index, line in enumerate(lines):
        start, end = float(line["start"]), float(line["end"])
        text_words = words(line["text"])
        if not 0 <= start < end <= len(reference) / FS or end - start > 20 or not 1 <= len(text_words) <= 64:
            raise ValueError("Lyric lines must be bounded English words inside the source")
        progress(f"singing actual lyric line {index + 1}/{len(lines)}")
        text = " ".join(text_words)
        if text in cache:
            tts = cache[text]
        else:
            audio, tokens = sing.tts(text, "bf_emma", 1)
            if len(audio) > 30 * FS:
                raise ValueError("Stock speech exceeded its 30 second phrase budget")
            f0, times = pw.harvest(audio, FS, f0_floor=70, f0_ceil=800, frame_period=FP)
            sp, ap = pw.cheaptrick(audio, f0, times, FS, fft_size=FFT), pw.d4c(audio, f0, times, FS, fft_size=FFT)
            spans = token_spans(text_words, tokens)
            lo, hi = max(0, int((spans[0, 0] - 0.03) * 1000 / FP)), min(len(f0), int((spans[-1, 1] + 0.05) * 1000 / FP))
            tts = {"f0": f0[lo:hi], "lsp": np.log(sp[lo:hi] + 1e-12), "ap": ap[lo:hi], "features": features(sp[lo:hi]), "centers": spans.mean(axis=1) * 1000 / FP - lo}
            if len(cache) >= 4:
                del cache[next(iter(cache))]
            cache[text] = tts
        a, z = max(0, int(start * 1000 / FP)), min(count, int(math.ceil(end * 1000 / FP)))
        if z - a < 4:
            raise ValueError("A lyric line is too short to align")
        centers = np.asarray(line.get("wordCenters", np.linspace(start + 0.08, end - 0.08, len(text_words))), dtype=float)
        if len(centers) != len(text_words) or not np.isfinite(centers).all() or np.any(np.diff(centers) <= 0) or np.any(centers < start) or np.any(centers > end):
            raise ValueError("Invalid chronological lyric word centers")
        source_times = ref["times"][a:z]
        anchors = np.r_[source_times[0], centers, source_times[-1]]
        target_anchors = np.r_[0, tts["centers"], len(tts["f0"]) - 1]
        keep = np.r_[True, np.diff(anchors) > 0.005]
        expected = np.interp(source_times, anchors[keep], target_anchors[keep])
        mapping = align(ref["features"][a:z], tts["features"], expected)
        interpolate = lambda array: np.column_stack([np.interp(mapping, np.arange(len(array)), array[:, column]) for column in range(array.shape[1])])
        sp, ap = np.exp(interpolate(tts["lsp"])), interpolate(tts["ap"])
        source_f0 = ref["f0"][a:z].copy()
        voiced = source_f0 > 0
        filled = np.interp(np.arange(len(source_f0)), np.flatnonzero(voiced), source_f0[voiced]) if voiced.any() else np.full(len(source_f0), 220)
        tts_voiced = np.interp(mapping, np.arange(len(tts["f0"])), (tts["f0"] > 0).astype(float)) > 0.45
        gate = ref["rms"][a:z] > max(0.0015, float(np.max(ref["rms"][a:z])) * 0.025)
        f0 = np.where(tts_voiced & gate, filled, 0)
        chunk = pw.synthesize(f0, np.ascontiguousarray(sp), np.ascontiguousarray(np.clip(ap, 0, 1)), FS, FP)
        begin = a * HOP
        length = min((z - a) * HOP, len(reference) - begin, len(chunk))
        chunk = chunk[:length]
        target = np.interp(np.arange(length) / FS + source_times[0], ref["times"], ref["rms"])
        actual = np.sqrt(np.maximum(ndimage.uniform_filter1d(chunk * chunk, int(FS * 0.025)), 1e-12))
        chunk *= ndimage.gaussian_filter1d(np.clip(target / (actual + 1e-6), 0.04, 12), FS * 0.008)
        fade = min(int(FS * 0.03), length // 4)
        weight = np.ones(length)
        weight[:fade] = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
        weight[-fade:] = np.cos(np.linspace(0, np.pi / 2, fade)) ** 2
        out[begin:begin + length] += chunk * weight
        weights[begin:begin + length] += weight
        planned[a:z] = True
        reports.append({"index": index, "start": start, "end": end, "wordCount": len(text_words), "timingEvidence": line.get("timing", "supplied"), "mappingMaxStepFrames": float(np.max(np.diff(mapping))), "pitchControlFrames": int(np.sum(f0 > 0))})
    out /= np.maximum(1, weights)
    peak = float(np.max(np.abs(out)))
    if not np.isfinite(out).all() or peak < 1e-6:
        raise ValueError("Reference synthesis produced no finite audible vocal")
    out *= min(1, 0.49 / peak)
    progress("checking pitch, coverage, level matching and file integrity")
    estimated, times = pw.dio(out, FS, f0_floor=65, f0_ceil=1100, frame_period=FP)
    estimated = pw.stonemask(out, estimated, times, FS)
    source_f0 = np.interp(times, ref["times"], ref["f0"])
    active = (estimated > 0) & (source_f0 > 0) & planned[:len(times)]
    cents = 1200 * np.log2(estimated[active] / source_f0[active])
    target_rms = np.sqrt(np.maximum(ndimage.uniform_filter1d(reference * reference, int(FS * 0.03)), 1e-12))
    gate = (target_rms > max(0.003, float(target_rms.max()) * 0.03)) & (np.abs(out) > 0.0001)
    ratio = math.sqrt(float(np.mean(reference[gate] ** 2)) / max(float(np.mean(out[gate] ** 2)), 1e-12)) if gate.any() else 1
    ratio = float(np.clip(ratio, 0.05, 20))
    comparison_source, comparison_stock = reference.copy(), out * ratio
    common = min(1, 0.98 / max(float(np.max(np.abs(comparison_source))), float(np.max(np.abs(comparison_stock))), 1e-6))
    comparison_source *= common
    comparison_stock *= common
    for name, audio in [("stock.wav", out), ("comparison-source.wav", comparison_source), ("comparison-stock.wav", comparison_stock)]:
        with open(output / name, "xb") as stream:
            sf.write(stream, audio.astype(np.float32), FS, subtype="PCM_16", format="WAV")
    report = {"voice": "bf_emma", "referenceAudioUsedAsSamples": False, "finite": bool(np.isfinite(out).all()), "sampleRate": FS, "frames": len(out), "peak": float(np.max(np.abs(out))), "pitchComparisonFrames": int(np.sum(active)), "referenceVoicedMatchedFraction": float(np.sum(active) / max(1, np.sum((source_f0 > 0) & planned[:len(times)]))), "pitchMedianAbsoluteCents": float(np.median(np.abs(cents))) if len(cents) else None, "pitchP90AbsoluteCents": float(np.percentile(np.abs(cents), 90)) if len(cents) else None, "pitchOctaveErrorFraction": float(np.mean(np.abs(cents) > 700)) if len(cents) else None, "sourceVoicedSeconds": float(np.sum(ref["f0"] > 0) * FP / 1000), "uncoveredVoicedSeconds": float(np.sum((ref["f0"] > 0) & ~planned) * FP / 1000), "comparisonStockGainDb": float(20 * math.log10(ratio)), "comparisonCommonGainDb": float(20 * math.log10(common)), "wordClarity": {"status": "unverified", "evidence": "Supplied/transcribed words drive TTS; no independent ASR of output has been run"}, "tone": {"status": "approximate-stock-voice", "evidence": "Stock spectral envelope with reference continuous F0 and broad dynamics"}, "lines": reports, "provenance": {**provenance, "analysisDependencies": dependencies()}, "limitations": "Pitch controls and file integrity do not establish exact words, consonants, held endings or recorded timbre. Unlabelled wordless passages are left unfilled and reported."}
    with open(output / "report.json", "x") as stream:
        json.dump(report, stream)
    return {"synthesized": True, "frames": len(out)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--analyze", nargs=4, metavar=("REFERENCE", "CONTROLS", "ANALYSIS", "CONFIG"))
    group.add_argument("--synthesize", metavar="CONFIG")
    args = parser.parse_args()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = analyze(*args.analyze) if args.analyze else synthesize(args.synthesize)
        print(json.dumps(result), flush=True)
    except Exception as error:
        print(f"Reference backend: {str(error)[:1200]}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
