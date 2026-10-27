"""A sung rhythm from how a line is spoken: stressed words long, small words short.

Usage: cadence.py "<syllables>" bpm [beats] [voice] [grid]
  cadence.py "I don't need the morn- ing light" 128 3.5
Kokoro says the line; each word's length (split evenly over its syllables)
is scaled so the line fills `beats` and snapped to `grid` beats (0.25 =
16ths, 1/3 = triplet eighths). Prints the onsets and lengths for songs.py
line(), plus a gap before any word the speaker paused before. Start from
this and move notes by ear: it is a speech shape, not a melody.
"""
import json
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from sing import clean, tts  # noqa: E402

syls = sys.argv[1].split()
bpm = float(sys.argv[2])
beats = float(sys.argv[3]) if len(sys.argv) > 3 else None
voice = sys.argv[4] if len(sys.argv) > 4 else "af_heart"
grid = eval(sys.argv[5]) if len(sys.argv) > 5 else 0.25  # noqa: S307 (a number or fraction)

words, cur = [], []
for s in syls:
    cur.append(s)
    if not s.endswith("-"):
        words.append(cur)
        cur = []
text = " ".join("".join(x.rstrip("-") for x in w) for w in words)
_, toks = tts(text, voice, 1.0)
toks = [t for t in toks if t[0]]
spans, pos = [], 0
for w in words:
    target = clean("".join(x.rstrip("-") for x in w))
    while pos < len(toks) and toks[pos][0] != target:
        pos += 1
    if pos == len(toks):
        raise SystemExit(f"no token for {target}: {toks}")
    spans.append(toks[pos][1:])
    pos += 1
t0 = spans[0][0]
end = spans[-1][1]
scale = (beats / (end - t0)) if beats else bpm / 60
on, ln = [], []
for w, (s, e) in zip(words, spans):
    for k in range(len(w)):
        a = (s - t0 + (e - s) * k / len(w)) * scale
        b = (s - t0 + (e - s) * (k + 1) / len(w)) * scale
        on.append(round(round(a / grid) * grid, 4))
        ln.append(b - a)
# Strictly increasing onsets; each note lasts to the next minus a breath.
for k in range(1, len(on)):
    on[k] = max(on[k], on[k - 1] + grid)
lens = [round(max(grid * 0.8, (on[k + 1] - on[k]) - 0.05), 3) if k + 1 < len(on)
        else round(max(grid, ln[-1]), 3) for k in range(len(on))]
print(json.dumps({"syl": syls, "beats": on, "lens": lens}))
