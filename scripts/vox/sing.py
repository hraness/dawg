"""Speech-to-singing: Kokoro TTS words, WORLD-retuned onto a melody grid.

Usage: sing.py spec.json out.wav
spec = {
  "voice": "af_heart", "speed": 1.0, "bpm": 140, "bars": 2,
  "formant": 0.0,            # semitones, spectral-envelope shift
  "lead": 0.0,               # beats of silence before beat 0 in the file
  "notes": [ {"syl": "stay", "beat": 0, "len": 0.75, "midi": 69,
              "scoop": 0, "fall": 0, "glide": 0.03}, ... ]
}
Syllables of one word are written "to-" "night" (trailing hyphen continues
the word). The text sent to TTS is the words joined with spaces; "text" in
the spec overrides it (keep the same words). "speech": a wav path sings a
take another engine spoke instead of Kokoro (it must say the same words);
whisper.cpp times its words ($WHISPER_MODEL, default the small.en model in
~/.cache/dawg/whisper).
Prints JSON with per-note [begin, end] file fractions for sample slices.
"""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
import pyworld as pw
import soundfile as sf
from kokoro import KPipeline

FS = 24000
FP = 5.0  # ms per WORLD frame


def words_of(notes):
    words, cur = [], []
    for i, n in enumerate(notes):
        cur.append(i)
        if not n["syl"].endswith("-"):
            words.append(cur)
            cur = []
    if cur:
        words.append(cur)
    return words


def clean(w):
    return "".join(c for c in w.lower() if c.isalpha() or c == "'")


def tts(text, voice, speed):
    pipe = KPipeline(lang_code=voice[0], repo_id="hexgrad/Kokoro-82M")
    audio, toks, off = [], [], 0.0
    for r in pipe(text, voice=voice, speed=speed):
        a = r.audio.numpy() if hasattr(r.audio, "numpy") else np.asarray(r.audio)
        for t in r.tokens or []:
            if t.start_ts is None:
                continue
            w = clean(t.text)
            if w:
                toks.append((w, off + t.start_ts, off + t.end_ts))
        audio.append(a)
        off += len(a) / FS
    return np.concatenate(audio).astype(np.float64), toks


def speech(path, text):
    """A spoken take of `text` from a file, its words timed by whisper.cpp."""
    model = os.environ.get("WHISPER_MODEL", os.path.expanduser("~/.cache/dawg/whisper/ggml-small.en.bin"))
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(FS), f"{tmp}/a.wav"], check=True)
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", f"{tmp}/w.wav"], check=True)
        subprocess.run(["whisper-cli", "-m", model, "-f", f"{tmp}/w.wav", "-ml", "1", "-sow", "-oj", "-np",
                        "--prompt", text, "-of", f"{tmp}/w"], check=True, capture_output=True)
        y, _ = sf.read(f"{tmp}/a.wav", dtype="float64")
        words = json.loads(open(f"{tmp}/w.json").read())["transcription"]
    toks = [(clean(w["text"]), w["offsets"]["from"] / 1000, w["offsets"]["to"] / 1000) for w in words]
    return y, [t for t in toks if t[0]]


def word_spans(words, notes, toks):
    """Each spec word's (start, end) seconds, matched letter by letter.

    Recognizers merge and split words ("mouth full" comes back "Mouthful"),
    so the tokens become one letter stream, each letter timed by its share of
    its token, and each word is found in order, at a token start if it can be.
    """
    letters, starts, ends, heads = "", [], [], set()
    for w, s, e in toks:
        heads.add(len(letters))
        for k in range(len(w)):
            starts.append(s + (e - s) * k / len(w))
            ends.append(s + (e - s) * (k + 1) / len(w))
        letters += w
    pos, spans = 0, []
    for w in words:
        target = clean("".join(notes[i]["syl"].rstrip("-") for i in w))
        hits, i = [], letters.find(target, pos)
        while i >= 0:
            hits.append(i)
            i = letters.find(target, i + 1)
        if not hits:
            raise SystemExit(f"word not found in TTS tokens: {target} ({toks})")
        whole = [i for i in hits if i in heads and (i + len(target) in heads or i + len(target) == len(letters))]
        i = (whole or [i for i in hits if i in heads] or hits)[0]
        spans.append((starts[i], ends[i + len(target) - 1]))
        pos = i + len(target)
    return spans


def syllable_bounds(env, f0, a, b, k):
    """Split frames [a,b) into k syllables at energy valleys between nuclei."""
    if k == 1:
        return [(a, b)]
    seg = env[a:b].copy()
    seg[f0[a:b] <= 0] -= 3  # unvoiced frames are never nuclei
    sm = np.convolve(seg, np.ones(5) / 5, "same")
    # Greedy peaks with a minimum spacing.
    order = np.argsort(sm)[::-1]
    peaks = []
    gap = max(6, (b - a) // (k * 2))
    for i in order:
        if all(abs(i - p) >= gap for p in peaks):
            peaks.append(i)
        if len(peaks) == k:
            break
    peaks.sort()
    cuts = [a]
    for p, q in zip(peaks, peaks[1:]):
        cuts.append(a + p + int(np.argmin(sm[p:q])))
    cuts.append(b)
    return list(zip(cuts, cuts[1:]))


def resample_frames(x, n):
    if n <= 0:
        return x[:0]
    if len(x) == 1:
        return np.repeat(x, n, axis=0)
    src = np.linspace(0, len(x) - 1, n)
    i0 = np.floor(src).astype(int)
    i1 = np.minimum(i0 + 1, len(x) - 1)
    w = (src - i0)[:, None]
    return x[i0] * (1 - w) + x[i1] * w


def shift_env(sp, semis):
    if not semis:
        return sp
    r = 2 ** (semis / 12)
    bins = sp.shape[1]
    src = np.arange(bins) / r
    out = np.empty_like(sp)
    for i in range(len(sp)):
        out[i] = np.interp(src, np.arange(bins), sp[i], right=sp[i, -1])
    return out


def main():
    spec = json.loads(open(sys.argv[1]).read())
    notes = spec["notes"]
    bpm = spec["bpm"]
    spb = 60 / bpm
    words = words_of(notes)
    text = spec.get("text") or " ".join(
        "".join(notes[i]["syl"].rstrip("-") for i in w) for w in words
    )
    if spec.get("speech"):
        y, toks = speech(spec["speech"], text)
    else:
        y, toks = tts(text, spec["voice"], spec.get("speed", 1.0))
    f0, t = pw.harvest(y, FS, f0_floor=70, f0_ceil=600, frame_period=FP)
    sp = pw.cheaptrick(y, f0, t, FS)
    ap = pw.d4c(y, f0, t, FS)
    lsp = np.log(sp + 1e-12)
    env = lsp[:, 8:130].mean(axis=1)  # ~200 Hz - 3 kHz energy (log)
    segs = []  # (note index, frame a, frame b)
    for w, (s, e) in zip(words, word_spans(words, notes, toks)):
        a = min(int(s * 1000 / FP), len(f0) - 2)
        b = max(a + 2, min(len(f0), int(e * 1000 / FP)))
        for i, (sa, sb) in zip(w, syllable_bounds(env, f0, a, b, len(w))):
            segs.append((i, sa, sb))
    lead = spec.get("lead", 0.0)
    total_beats = spec["bars"] * 4 + lead
    nfr = int(total_beats * spb * 1000 / FP) + 1
    bins = sp.shape[1]
    o_lsp = np.full((nfr, bins), np.log(1e-12))
    o_ap = np.ones((nfr, bins))
    o_f0 = np.zeros(nfr)
    o_w = np.zeros(nfr)  # occupancy for crossfades
    marks = []
    prev_midi = None
    for i, a, b in segs:
        n = notes[i]
        v = f0[a:b] > 0
        if v.any():
            va = a + int(np.argmax(v))
            vb = a + len(v) - int(np.argmax(v[::-1]))
        else:
            va, vb = a, b
        onset = (a, va)
        nucleus = (va, vb)
        coda = (vb, b)
        start = (n["beat"] + lead) * spb
        dur = n["len"] * spb
        on_fr = onset[1] - onset[0]
        coda_fr = min(coda[1] - coda[0], int(0.12 * 1000 / FP))
        gap = int(n.get("gap", 0.03) * 1000 / FP)
        nuc_fr = max(4, int(dur * 1000 / FP) - coda_fr - gap)
        t0 = int(start * 1000 / FP) - on_fr
        pieces = [
            (lsp[onset[0] : onset[1]], ap[onset[0] : onset[1]], f0[onset[0] : onset[1]]),
            (resample_frames(lsp[nucleus[0] : nucleus[1]], nuc_fr),
             resample_frames(ap[nucleus[0] : nucleus[1]], nuc_fr), None),
            (lsp[coda[0] : coda[0] + coda_fr], ap[coda[0] : coda[0] + coda_fr], f0[coda[0] : coda[0] + coda_fr]),
        ]
        L = sum(len(p[0]) for p in pieces)
        q_lsp = np.concatenate([p[0] for p in pieces])
        q_ap = np.concatenate([p[1] for p in pieces])
        # Pitch: voiced frames take the note; the first frames glide from the
        # previous note (hard tune); optional scoop up / fall at the end.
        hz = 440 * 2 ** ((n["midi"] - 69) / 12)
        src_f0 = np.concatenate([pieces[0][2], np.ones(nuc_fr), pieces[2][2]])
        voiced = src_f0 > 0
        semis = np.full(L, float(n["midi"]))
        g = int(n.get("glide", 0.03) * 1000 / FP)
        if prev_midi is not None and g > 0 and n.get("legato", True):
            k = min(g, L)
            semis[:k] = np.linspace(prev_midi, n["midi"], k)
        if n.get("scoop"):
            k = min(int(0.08 * 1000 / FP), L)
            semis[on_fr : on_fr + k] += np.linspace(-n["scoop"], 0, len(semis[on_fr : on_fr + k]))
        if n.get("fall"):
            k = min(int(0.12 * 1000 / FP), L)
            semis[L - k :] += np.linspace(0, -n["fall"], k)
        if n.get("vib"):
            tt = np.arange(L) * FP / 1000
            ramp = np.clip((tt - 0.25) / 0.2, 0, 1)
            semis += n["vib"] * ramp * np.sin(2 * np.pi * 5.5 * tt)
        q_f0 = np.where(voiced, 440 * 2 ** ((semis - 69) / 12), 0.0)
        # Write with a short crossfade into whatever is already there.
        lo, hi = max(0, t0), min(nfr, t0 + L)
        off = lo - t0
        for j in range(lo, hi):
            k = j - t0
            fade = min(1.0, (k + 1) / 3) if o_w[j] > 0 else 1.0
            o_lsp[j] = o_lsp[j] * (1 - fade) + q_lsp[k] * fade if o_w[j] > 0 else q_lsp[k]
            o_ap[j] = o_ap[j] * (1 - fade) + q_ap[k] * fade if o_w[j] > 0 else q_ap[k]
            o_f0[j] = q_f0[k] if (q_f0[k] > 0 or fade >= 1) else o_f0[j]
            o_w[j] = 1
        marks.append([lo, hi])
        prev_midi = n["midi"]
    o_sp = np.exp(o_lsp)
    o_sp = shift_env(o_sp, spec.get("formant", 0.0))
    # Unvoiced holes inside a note make WORLD buzz-free; silence stays silent.
    o_ap = np.clip(o_ap, 0, 1)
    # "clarity" > 1 pulls aperiodicity down on voiced frames (less breath).
    c = spec.get("clarity", 1.0)
    if c != 1.0:
        v = o_f0 > 0
        o_ap[v] = o_ap[v] ** c
    out = pw.synthesize(o_f0, np.ascontiguousarray(o_sp), np.ascontiguousarray(o_ap), FS, FP)
    n_samples = int(total_beats * spb * FS)
    out = out[:n_samples] if len(out) >= n_samples else np.pad(out, (0, n_samples - len(out)))
    # Normalize to about -6.2 dBFS peak (under the studio 16384 ceiling) with 5 ms boundary fades.
    out *= 0.49 / (np.abs(out).max() + 1e-9)
    f = int(0.005 * FS)
    out[:f] *= np.linspace(0, 1, f)
    out[-f:] *= np.linspace(1, 0, f)
    sf.write(sys.argv[2], out.astype(np.float32), FS, subtype="PCM_16")
    total = nfr
    print(json.dumps({
        "seconds": round(n_samples / FS, 4),
        "slices": [
            {"syl": notes[i]["syl"], "begin": round(lo / total, 5), "end": round(hi / total, 5)}
            for (i, _, _), (lo, hi) in zip(segs, marks)
        ],
    }))


if __name__ == "__main__":
    main()
