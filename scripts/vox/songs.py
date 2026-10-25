"""The hyperpop demo vocal books: every sung line of a song plus a chop bank.

Usage: songs.py <out dir> [id ...]
       songs.py --spec song.json out.wav   (a chart's book, from chart-book.ts)
Each part is sung on its own (sing.py) with a quarter-beat lead for onset
consonants, then the parts are laid end to end in one file. Verse and pre
lines are one bar, chorus lines two. The chop bank is single syllables on one
pitch (the sample root) so a keyed sampler can re-pitch them into riffs, and
"hold" is a sustained vowel for loops and grain clouds.
Prints the slice table (file fractions) for core/bundled-samples.ts.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

HERE = Path(__file__).parent
FS = 24000
LEAD = 0.25


def N(syl, beat, length, midi, **kw):
    return {"syl": syl, "beat": beat, "len": length, "midi": midi, **kw}


def line(words, beats, midis, lens=None, **last):
    """Syllables on the given beats; each lasts until the next unless lens says."""
    notes = []
    for k, (syl, beat, midi) in enumerate(zip(words, beats, midis)):
        nxt = beats[k + 1] if k + 1 < len(beats) else beat + 1
        length = lens[k] if lens else nxt - beat
        notes.append(N(syl, beat, length, midi))
    notes[-1].update(last)
    return notes


def chops(root, words):
    return [(w, 1.0, [N(w, 0, 0.7, root, legato=False, gap=0.05)]) for w in words]


# First-verse rhythms, alternating line by line so no two neighbours match:
# R1 lands 3-3-2 then runs three 16ths into the last word; R2 opens on 16ths
# and stretches out over the bar.
R1 = [0, 0.75, 1.5, 2, 2.25, 2.5, 3]
R1L = [0.6, 0.6, 0.45, 0.25, 0.25, 0.45, 0.9]
R2 = [0, 0.25, 0.5, 1, 1.75, 2.5, 3]
R2L = [0.25, 0.25, 0.45, 0.6, 0.6, 0.45, 0.9]
# Second verses sing four words a line on long notes that leap, the last one
# held to the end of the bar.
L4 = [0, 0.75, 1.5, 2]
L4L = [0.6, 0.6, 0.45, 1.6]
L5 = [0, 0.75, 1.5, 2, 2.5]
L5L = [0.6, 0.6, 0.45, 0.45, 1.3]
# Redline sings half-time over 172: eighths only, the last word held.
E1 = [0, 0.5, 1, 1.5, 2, 3]
E1L = [0.45, 0.45, 0.45, 0.45, 0.9, 0.9]
E2 = [0, 0.5, 1, 1.5, 2.5, 3]
E2L = [0.45, 0.45, 0.45, 0.9, 0.45, 0.9]
Q4 = [0, 0.5, 1, 2]
Q4L = [0.45, 0.45, 0.9, 1.8]
Q5 = [0, 0.5, 1, 1.5, 2]
Q5L = [0.45, 0.45, 0.45, 0.45, 1.8]

SONGS = {
    # Soft Reboot, D major at 140. Verse Bm-G-D-A, chorus G-A-Bm-D.
    "soft-reboot-vox": dict(
        title="Soft Reboot Vocal", voice="af_heart", bpm=140, formant=1.0, root=69,
        parts=[
            ("v1", 4, line("sta- tic on the line a- gain".split(), R1, [69, 69, 71, 69, 74, 71, 69], R1L, fall=1.0)),
            ("v2", 4, line("pix- els where your face had been".split(), R2, [71, 71, 74, 71, 76, 74, 71], R2L, fall=1.0)),
            ("v3", 4, line("turn it off and on a- gain".split(), R1, [69, 69, 71, 69, 74, 76, 74], R1L)),
            ("v4", 4, line("may- be we can just be- gin".split(), R2, [73, 73, 71, 69, 71, 69, 66], R2L, fall=2.0)),
            ("v5", 4, line("saved all your songs".split(), L4, [74, 71, 69, 66], L4L)),
            ("v6", 4, line("cached what you said".split(), L4, [69, 74, 78, 76], L4L, fall=1.0)),
            ("v7", 4, line("through ev- ery crash".split(), L4, [66, 71, 74, 78], L4L)),
            ("v8", 4, line("I'm com- ing back".split(), L4, [69, 74, 76, 81], L4L, scoop=1.0)),
            ("pre1", 4, line("count me down from ten".split(), [0, 0.5, 1, 1.5, 2], [74, 74, 73, 71, 69], [0.5, 0.5, 0.5, 0.5, 1.8])),
            ("pre2", 4, line("bring me back to when".split(), [0, 0.5, 1, 1.5, 2], [76, 76, 74, 73, 76], [0.5, 0.5, 0.5, 0.5, 1.8], scoop=1.0)),
            ("ch1", 8, line("stay with me to- night".split(), [0, 1, 1.5, 2.5, 3], [74, 78, 81, 79, 76], [0.9, 0.5, 0.9, 0.5, 3.5], fall=2.0)),
            ("ch2", 8, line("start it o- ver one more time".split(), [0, 0.5, 1, 1.5, 2.5, 3, 4], [78, 78, 81, 78, 76, 73, 74], [0.5, 0.5, 0.5, 0.9, 0.5, 0.9, 3.0], fall=1.0)),
            ("ch3", 8, line("soft re- boot I'm com- ing back to life".split(), [0, 0.5, 1, 2, 2.5, 3, 3.5, 4, 4.5], [74, 76, 78, 81, 81, 78, 76, 78, 81], [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 2.8])),
            *chops(69, ["stay", "night", "back", "life", "oh", "yeah"]),
            ("hold", 4, [N("ooh", 0, 3.8, 69, vib=0.15)]),
        ],
    ),
    # Low Battery, F# minor at 150. Verse F#m-D-A-E, chorus D-E-C#m-F#m.
    "low-battery-vox": dict(
        title="Low Battery Vocal", voice="af_bella", bpm=150, formant=1.5, root=69,
        parts=[
            ("v1", 4, line("two per- cent and fad- ing fast".split(), R1, [73, 73, 71, 69, 71, 69, 66], R1L, fall=1.0)),
            ("v2", 4, line("hold- ing on to what we had".split(), R2, [74, 74, 73, 71, 73, 71, 69], R2L)),
            ("v3", 4, line("red light blink- ing on my hand".split(), R1, [73, 73, 76, 73, 71, 69, 71], R1L)),
            ("v4", 4, line("plug me in I'll un- der- stand".split(), R2, [71, 71, 73, 71, 69, 68, 69], R2L, fall=2.0)),
            ("v5", 4, line("run- ning on fumes".split(), L4, [73, 69, 66, 66], L4L)),
            ("v6", 4, line("burn- ing too hot".split(), L4, [68, 73, 76, 80], L4L, fall=1.0)),
            ("v7", 4, line("left me on read".split(), L4, [66, 69, 73, 78], L4L)),
            ("v8", 4, line("all you nev- er said".split(), L5, [76, 73, 76, 80, 81], L5L, scoop=1.0)),
            ("pre1", 4, line("don't let me go dark".split(), [0, 0.5, 1, 1.5, 2], [76, 76, 74, 73, 71], [0.5, 0.5, 0.5, 0.5, 1.8], fall=1.0)),
            ("pre2", 4, line("you're my on- ly spark".split(), [0, 0.5, 1, 1.5, 2], [76, 76, 78, 76, 80], [0.5, 0.5, 0.5, 0.5, 1.8], scoop=1.0)),
            ("ch1", 8, line("low bat- tery low bat- tery".split(), [0, 1, 1.5, 2.5, 3.5, 4], [78, 81, 76, 81, 80, 76], [0.9, 0.5, 0.9, 0.9, 0.5, 2.4], fall=1.0)),
            ("ch2", 8, line("give me your en- er- gy".split(), [0, 0.5, 1, 1.5, 2.5, 3], [76, 76, 78, 80, 81, 80], [0.5, 0.5, 0.5, 0.9, 0.5, 4.0], vib=0.3)),
            ("ch3", 8, line("charge me up don't let me fade a- way".split(), [0, 0.5, 1, 2, 2.5, 3, 3.5, 4.5, 5], [76, 76, 80, 81, 80, 78, 76, 78, 81], [0.5, 0.5, 0.9, 0.5, 0.5, 0.5, 0.9, 0.5, 2.5], fall=2.0)),
            *chops(69, ["low", "charge", "up", "fade", "hey", "ah"]),
            ("hold", 4, [N("ah", 0, 3.8, 69, vib=0.15)]),
        ],
    ),
    # Glass Garden, A major at 128. Verse A-E-F#m-Dm, chorus D-E-C#m-F#m.
    "glass-garden-vox": dict(
        title="Glass Garden Vocal", voice="af_sky", bpm=128, formant=1.0, clarity=1.4, root=69,
        parts=[
            ("v1", 4, line("plant- ed some- thing in the light".split(), R1, [73, 73, 74, 73, 76, 74, 73], R1L, fall=1.0)),
            ("v2", 4, line("watched it grow- ing through the night".split(), R2, [73, 73, 78, 76, 73, 69, 66], R2L)),
            ("v3", 4, line("ev- ery flow- er made of glass".split(), R1, [73, 73, 76, 73, 71, 69, 73], R1L)),
            ("v4", 4, line("hold it close but not too fast".split(), R2, [71, 71, 73, 71, 69, 68, 71], R2L, fall=1.0)),
            ("v5", 4, line("rain on the roof".split(), L4, [76, 73, 69, 73], L4L)),
            ("v6", 4, line("drops of the truth".split(), L4, [69, 73, 78, 76], L4L, fall=1.0)),
            ("v7", 4, line("I'll make it new".split(), L4, [69, 73, 76, 81], L4L)),
            ("v8", 4, line("grow out of you".split(), L4, [78, 76, 73, 78], L4L, scoop=1.0)),
            ("pre1", 4, line("care- ful care- ful now".split(), [0, 0.5, 1, 1.5, 2], [76, 73, 76, 73, 71], [0.5, 0.5, 0.5, 0.5, 1.8], fall=1.0)),
            ("pre2", 4, line("let it bloom and grow".split(), [0, 0.5, 1, 2, 2.5], [74, 76, 78, 76, 80], [0.5, 0.5, 0.9, 0.5, 1.4], scoop=1.0)),
            ("ch1", 8, line("in my glass gar- den".split(), [0, 0.5, 1, 2, 3], [74, 78, 81, 78, 76], [0.5, 0.5, 0.9, 0.9, 3.0], fall=1.0)),
            ("ch2", 8, line("ev- ery- thing's gold- en".split(), [0, 0.5, 1, 2, 2.5], [73, 76, 80, 78, 81], [0.5, 0.5, 0.9, 0.5, 3.5])),
            ("ch3", 8, line("don't you ev- er let the sun- light go".split(), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], [76, 76, 80, 76, 80, 81, 80, 76, 78], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 3.0], fall=2.0)),
            *chops(69, ["glass", "bloom", "gold", "grow", "ah", "ooh"]),
            ("hold", 4, [N("ooh", 0, 3.8, 69, vib=0.15)]),
        ],
    ),
    # Redline, F minor at 172, sung half-time over the breaks. Verse
    # Fm-Ab-Eb-Db, pre Db-Eb, chorus Fm-Db-Ab-Eb.
    "redline-vox": dict(
        title="Redline Vocal", voice="af_heart", bpm=172, formant=1.0, clarity=1.6, root=68,
        parts=[
            ("v1", 4, line("ne- on on the high- way".split(), E1, [72, 72, 68, 72, 75, 72], E1L)),
            ("v2", 4, line("cit- y in the mir- ror".split(), E2, [70, 70, 67, 70, 75, 70], E2L, fall=1.0)),
            ("v3", 4, line("hands up out the win- dow".split(), E1, [72, 72, 75, 72, 77, 75], E1L)),
            ("v4", 4, line("no- bod- y can catch us".split(), E2, [75, 72, 70, 67, 70, 67], E2L, fall=1.0)),
            ("v5", 4, line("fast- er than the fear".split(), Q5, [77, 75, 72, 75, 72], Q5L)),
            ("v6", 4, line("no- where but here".split(), Q4, [75, 70, 67, 70], Q4L, fall=1.0)),
            ("v7", 4, line("en- gine in my chest".split(), Q5, [72, 75, 77, 75, 80], Q5L)),
            ("v8", 4, line("nev- er gon- na rest".split(), Q5, [79, 77, 75, 70, 75], Q5L, scoop=1.0)),
            ("pre1", 4, line("turn it up turn it up".split(), [0, 0.5, 1, 2, 2.5, 3], [68, 68, 73, 73, 73, 77], [0.45, 0.45, 0.9, 0.45, 0.45, 0.9])),
            ("pre2", 4, line("take it to the red".split(), Q5, [75, 75, 77, 75, 80], Q5L, scoop=1.0)),
            ("ch1", 8, line("red- line we're on the red- line".split(), [0, 1, 2.5, 3, 3.5, 4, 5], [80, 77, 75, 75, 77, 80, 77], [0.9, 1.4, 0.45, 0.45, 0.45, 0.9, 2.8], fall=1.0)),
            ("ch2", 8, line("don't you slow it down to- night".split(), [0, 0.5, 1, 2, 2.5, 4, 4.5], [75, 75, 80, 77, 75, 77, 79], [0.45, 0.45, 0.9, 0.45, 1.4, 0.45, 3.0], vib=0.3)),
            ("ch3", 8, line("hold on tight 'til the sky turns white".split(), [0, 0.5, 1, 2, 2.5, 3, 4, 5], [75, 77, 80, 77, 75, 80, 77, 79], [0.45, 0.45, 0.9, 0.45, 0.45, 0.9, 0.9, 2.8], fall=1.0)),
            *chops(68, ["red", "line", "go", "up", "hey", "oh"]),
            ("hold", 4, [N("ah", 0, 3.8, 68, vib=0.15)]),
        ],
    ),
}


def render(song, out):
    bpm = song["bpm"]
    spb = 60 / bpm
    chunks, slices, cursor = [], [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, beats, notes in song["parts"]:
            spec = {"voice": song["voice"], "bpm": bpm, "bars": beats / 4, "lead": LEAD,
                    "formant": song.get("formant", 0.0), "clarity": song.get("clarity", 1.0),
                    "notes": notes}
            sp, wp = Path(tmp) / f"{name}.json", Path(tmp) / f"{name}.wav"
            sp.write_text(json.dumps(spec))
            for _ in range(2):  # one retry: a cold Kokoro load can fail transiently
                res = subprocess.run([sys.executable, "-I", str(HERE / "sing.py"), str(sp), str(wp)],
                                     capture_output=True, text=True)
                if not res.returncode:
                    break
            if res.returncode:
                print(res.stderr[-2000:])
                raise SystemExit(f"sing failed for {name}")
            audio, fs = sf.read(wp, dtype="float64")
            assert fs == FS
            n = int(round((beats + LEAD) * spb * FS))
            audio = audio[:n] if len(audio) >= n else np.pad(audio, (0, n - len(audio)))
            chunks.append(audio)
            slices.append((name, cursor, cursor + n))
            cursor += n
    y = np.concatenate(chunks)
    y *= 0.49 / (np.abs(y).max() + 1e-9)
    sf.write(out, y.astype(np.float32), FS, subtype="PCM_16")
    total = len(y)
    return {
        "seconds": round(total / FS, 4),
        "bpm": bpm,
        "slices": [{"name": s, "begin": round(a / total, 6), "end": round(b / total, 6)}
                   for s, a, b in slices],
    }


def main():
    if sys.argv[1] == "--spec":
        # {"voice", "bpm", "formant"?, "clarity"?, "parts": [[name, beats, notes]]}
        song = json.loads(Path(sys.argv[2]).read_text())
        table = render(song, Path(sys.argv[3]))
        print(json.dumps(table))
        return
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    only = sys.argv[2:]
    table = {}
    for sid, song in SONGS.items():
        if only and sid not in only:
            continue
        table[sid] = render(song, out / f"{sid}.wav")
        print(sid, table[sid]["seconds"], flush=True)
    (out / "slices.json").write_text(json.dumps(table, indent=1))


if __name__ == "__main__":
    main()
