"""The three demo vocal files: two hook lines plus three held chop syllables.

Usage: phrases.py <out dir> [id ...]
Layout per file (beats at the demo tempo): LEAD beats of pre-roll, line A on
beats 0-8, line B on 8-16, chops at 16, 17.5 and 19 (1 beat each).
Prints the slice table (file fractions) for core/bundled-samples.ts.
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
LEAD = 0.5
PRE = 0.25  # slices start this many beats before their downbeat (consonants)

N = lambda syl, beat, length, midi, **kw: {"syl": syl, "beat": beat, "len": length, "midi": midi, **kw}

PHRASES = {
    # Soft Reboot: D major, I-V-vi-IV at 130.
    "stay-tonight": dict(
        voice="af_heart", bpm=130, formant=1.0,
        lines=[
            [N("stay", 0, 0.75, 69), N("with", 0.75, 0.5, 66), N("me", 1.5, 1, 69),
             N("to-", 2.5, 0.5, 71), N("night", 3, 2.5, 69, fall=1.0)],
            [N("ne-", 8, 0.5, 66), N("ver", 8.5, 0.5, 62), N("let", 9, 0.5, 66),
             N("me", 9.5, 1, 64, scoop=1.0), N("go", 10.5, 3.0, 62, fall=2.0)],
        ],
        chops=[("stay", 69), ("night", 69), ("go", 74)],
    ),
    # Low Battery: F major, vi-IV-I-V at 140.
    "lights-out": dict(
        voice="af_bella", bpm=140, formant=1.5,
        lines=[
            [N("don't", 0, 0.5, 69), N("let", 0.5, 0.5, 69), N("the", 1, 0.5, 67),
             N("lights", 1.5, 1.25, 69), N("go", 2.75, 0.75, 72), N("out", 3.5, 2.5, 69, fall=1.0)],
            [N("I'm", 8, 0.5, 65), N("still", 8.5, 0.5, 69), N("hold-", 9, 1, 72),
             N("ing", 10, 0.5, 69), N("on", 10.5, 3.0, 67, fall=2.0)],
        ],
        chops=[("lights", 72), ("out", 69), ("on", 67)],
    ),
    # Glass Garden: A major, IV-I-V-vi at 136.
    "all-i-need": dict(
        voice="af_nicole", bpm=136, formant=1.0, clarity=1.4,
        lines=[
            [N("you're", 0, 0.5, 69), N("all", 0.5, 1.0, 74), N("I", 1.5, 0.5, 73),
             N("need", 2, 3.0, 69, fall=1.0)],
            [N("say", 8, 0.75, 71), N("my", 8.75, 0.75, 76),
             N("name", 9.5, 4.0, 73, fall=2.0)],
        ],
        chops=[("need", 69), ("name", 73), ("oh", 76)],
    ),
}


def spec_of(p):
    notes = [dict(n) for line in p["lines"] for n in line]
    for k, (syl, midi) in enumerate(p["chops"]):
        notes.append(N(syl, 16 + 1.5 * k, 1.0, midi, legato=False, gap=0.06))
    return {"voice": p["voice"], "bpm": p["bpm"], "bars": 5, "lead": LEAD,
            "formant": p.get("formant", 0.0), "clarity": p.get("clarity", 1.0), "notes": notes}


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    only = sys.argv[2:]
    table = {}
    for pid, p in PHRASES.items():
        if only and pid not in only:
            continue
        spec = spec_of(p)
        sp = out / f"{pid}.json"
        sp.write_text(json.dumps(spec, indent=1))
        res = subprocess.run([sys.executable, "-I", str(HERE / "sing.py"), str(sp), str(out / f"{pid}.wav")],
                             capture_output=True, text=True)
        if res.returncode:
            print(res.stderr[-2000:])
            raise SystemExit(f"sing failed for {pid}")
        info = json.loads(res.stdout.strip().splitlines()[-1])
        total = 20 + LEAD
        f = lambda beats: round(beats / total, 5)
        slices = [
            {"name": "line-a", "begin": f(LEAD - PRE), "end": f(LEAD + 8 - PRE)},
            {"name": "line-b", "begin": f(LEAD + 8 - PRE), "end": f(LEAD + 16 - PRE)},
        ] + [
            {"name": syl, "begin": f(LEAD + 16 + 1.5 * k - PRE), "end": f(LEAD + 16 + 1.5 * k + 1.0)}
            for k, (syl, _) in enumerate(p["chops"])
        ]
        table[pid] = {"seconds": info["seconds"], "bpm": p["bpm"], "slices": slices}
        print(pid, info["seconds"], flush=True)
    (out / "slices.json").write_text(json.dumps(table, indent=1))


if __name__ == "__main__":
    main()
