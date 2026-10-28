"""The hyperpop demo vocal books: every sung line of a song plus a chop bank.

Usage: songs.py <out dir> [id ...]
       songs.py --spec song.json out.wav   (a chart's book, from chart-book.ts)
Each part is sung on its own (sing.py) with a quarter-beat lead for onset
consonants, then the parts are laid end to end in one file. Verse and pre
lines are one bar, chorus lines two. The chop bank is single syllables on one
pitch (the sample root) so a keyed sampler can re-pitch them into riffs, and
"hold" is a sustained vowel for loops and grain clouds.
A part may carry a fourth element, a dict merged into its sing.py spec
(e.g. {"voice": "am_michael", "formant": -1}) for duets and low answers.
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
        title="Glass Garden Vocal", voice="bf_emma", bpm=128, speed=0.8, root=69,
        parts=[
            ("v1", 4, line("plant- ed some- thing in the light".split(), R1, [61, 61, 62, 61, 64, 62, 61], R1L, fall=1.0)),
            ("v2", 4, line("watched it grow- ing through the night".split(), R2, [61, 61, 66, 64, 61, 59, 57], R2L), {"speed": 0.6}),
            ("v3", 4, line("ev- ery flow- er made of glass".split(), R1, [61, 61, 64, 61, 59, 57, 61], R1L)),
            ("v4", 4, line("hold it close but not too fast".split(), R2, [59, 59, 61, 59, 57, 56, 59], R2L, fall=1.0)),
            ("v5", 4, line("rain on the roof".split(), L4, [64, 61, 57, 61], L4L)),
            ("v6", 4, line("green in the glass".split(), L4, [57, 61, 66, 64], L4L, fall=1.0)),
            ("v7", 4, line("I give it time".split(), L4, [57, 61, 64, 69], L4L)),
            ("v8", 4, line("so it can grow".split(), L4, [66, 64, 61, 66], L4L, scoop=1.0)),
            ("pre1", 4, line("care- ful care- ful now".split(), [0, 0.5, 1, 1.5, 2], [64, 61, 64, 61, 59], [0.5, 0.5, 0.5, 0.5, 1.8], fall=1.0)),
            ("pre2", 4, line("let it bloom and grow".split(), [0, 0.5, 1, 2, 2.5], [62, 64, 66, 64, 68], [0.5, 0.5, 0.9, 0.5, 1.4], scoop=1.0)),
            ("ch1", 8, line("in my glass gar- den".split(), [0, 0.5, 1, 2, 3], [69, 71, 74, 69, 66], [0.5, 0.5, 0.9, 0.9, 3.0], fall=1.0), {"speed": 0.6}),  # slower read keeps "glass garden" from blurring
            ("ch2", 8, line("ev- ery pet- al glows".split(), [0, 0.5, 1, 2, 2.5], [64, 68, 73, 71, 68], [0.5, 0.5, 0.9, 0.5, 3.5]), {"speed": 0.6}),
            ("ch3", 8, line("don't you ev- er let the sun- light go".split(), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], [68, 68, 71, 68, 71, 73, 71, 68, 66], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 3.0], fall=2.0)),
            *chops(69, ["glass", "bloom", "glow", "grow", "ah", "ooh"]),
            ("hold", 4, [N("ooh", 0, 3.8, 69, vib=0.15)]),
        ],
    ),
    # Redline, F minor at 172, sung half-time over the breaks. Verse
    # Fm-Ab-Eb-Db, pre Db-Eb, chorus Fm-Db-Ab-Eb.
    "redline-vox": dict(
        title="Redline Vocal", voice="bf_emma", bpm=172, speed=0.8, root=68,
        parts=[
            # Verses talk low (C4-Bb4) like Hannah Diamond's; the chorus lifts to Ab4-C5.
            ("v1", 4, line("win- dows down at mid- night".split(), E1, [65, 65, 63, 65, 68, 65], E1L)),
            ("v2", 4, line("cit- y in the mir- ror".split(), E2, [63, 63, 60, 63, 67, 63], E2L, fall=1.0)),
            ("v3", 4, line("turn the ra- di- o up".split(), E1, [68, 68, 72, 68, 65, 68], E1L)),
            ("v4", 4, line("no- bod- y can see us".split(), E2, [67, 65, 63, 63, 65, 63], E2L, fall=1.0)),
            ("v5", 4, line("white lines like a pulse".split(), Q5, [68, 68, 65, 63, 65], Q5L)),
            ("v6", 4, line("all the way home".split(), Q4, [63, 65, 67, 63], Q4L, fall=1.0)),
            ("v7", 4, line("en- gine in my chest".split(), Q5, [65, 68, 65, 63, 60], Q5L)),
            ("v8", 4, line("beat- ing like a drum".split(), Q5, [67, 70, 67, 65, 63], Q5L, scoop=1.0)),
            ("pre1", 4, line("I don't wan- na go".split(), Q5, [61, 61, 63, 65, 68], Q5L)),
            ("pre2", 4, line("take me to the line".split(), Q5, [61, 63, 65, 68, 73], Q5L, scoop=1.0)),
            ("ch1", 8, line("red- line take me to the red- line".split(), [0, 1, 2.5, 3, 3.5, 3.75, 4, 5], [72, 68, 68, 70, 72, 72, 73, 68], [0.9, 1.4, 0.45, 0.45, 0.25, 0.25, 0.9, 2.8], fall=1.0)),
            ("ch2", 8, line("don't you slow it down to- night".split(), [0, 0.5, 1, 2, 2.5, 4, 4.5], [72, 72, 75, 72, 70, 67, 70], [0.45, 0.45, 0.9, 0.45, 1.4, 0.45, 3.0], vib=0.3)),
            ("ch3", 8, line("hold on tight 'til the sky turns white".split(), [0, 0.5, 1, 2, 2.5, 3, 4, 5], [68, 70, 72, 72, 70, 72, 70, 67], [0.45, 0.45, 0.9, 0.45, 0.45, 0.9, 0.9, 2.8], fall=1.0)),
            *chops(68, ["red", "line", "go", "up", "hey", "oh"]),
            ("hold", 4, [N("ah", 0, 3.8, 68, vib=0.15)]),
        ],
    ),
    # Night Swim, D major at 122, sung low (A3-D5) on speech rhythms from
    # cadence.py. Verse Gmaj9-F#m7-Em9-A, chorus Bm9-Gmaj7-D/F#-A. Parts are
    # their own lengths; the demo places each line, pickups included.
    "night-swim-vox": dict(
        title="Night Swim Vocal", voice="bf_emma", bpm=122, root=62, human=0.25,
        parts=[
            ("v1", 4, line("shoes in my hand at the gate".split(), [0, 0.5, 0.75, 1, 1.5, 1.75, 2], [62, 62, 62, 64, 62, 62, 59], [0.45, 0.2, 0.2, 0.45, 0.2, 0.2, 1.3], fall=0.5)),
            ("v2", 4, line("light on the wa- ter still warm".split(), [0, 0.5, 0.75, 1, 1.25, 1.75, 2.25], [64, 64, 62, 62, 59, 62, 64], [0.45, 0.2, 0.2, 0.2, 0.45, 0.45, 1.4])),
            ("v3", 4, line("you knew a gap in the fence".split(), [0, 0.25, 0.5, 1, 1.5, 1.75, 2.25], [62, 62, 62, 66, 64, 62, 62], [0.2, 0.2, 0.45, 0.45, 0.2, 0.45, 1.3], fall=0.5)),
            ("v4", 4, line("so we climbed in an- y- way".split(), [0, 0.25, 0.5, 1, 1.25, 1.5, 2], [59, 59, 62, 62, 61, 59, 57], [0.2, 0.2, 0.45, 0.2, 0.2, 0.45, 1.6], fall=1.0)),
            ("v5", 4, line("phone on the edge of the deck".split(), [0, 0.5, 0.75, 1, 1.5, 1.75, 2], [64, 64, 64, 66, 64, 62, 62], [0.45, 0.2, 0.2, 0.45, 0.2, 0.2, 1.3])),
            ("v6", 4, line("glow- ing a- gain let it go".split(), [0, 0.5, 0.75, 1, 2, 2.5, 2.75], [66, 64, 62, 64, 62, 64, 59], [0.45, 0.2, 0.2, 0.7, 0.45, 0.2, 1.2], fall=0.5)),
            ("v7", 4, line("down where the wa- ter is qui- et".split(), [0, 0.5, 0.75, 1, 1.5, 2, 2.5, 3], [62, 62, 62, 64, 66, 64, 66, 64], [0.45, 0.2, 0.2, 0.45, 0.45, 0.45, 0.45, 0.9])),
            ("v8", 4, line("on- ly the sound of your heart".split(), [0, 0.25, 0.5, 0.75, 1.5, 1.75, 2], [62, 64, 66, 69, 66, 64, 64], [0.2, 0.2, 0.2, 0.7, 0.2, 0.2, 1.4], vib=0.12)),
            ("pre1", 4, line("hold your breath count to three".split(), [0, 0.5, 0.75, 1, 1.5, 1.75], [66, 66, 66, 69, 66, 69], [0.45, 0.2, 0.2, 0.45, 0.2, 1.6])),
            ("pre2", 4, line("don't come up don't come up yet".split(), [0, 0.5, 1, 1.5, 2, 2.5, 3], [69, 69, 71, 69, 69, 71, 73], [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 1.8], scoop=0.5)),
            ("ch1", 8, line("stay un- der with me".split(), [0, 1.25, 1.75, 2.25, 3.25], [66, 69, 71, 69, 67], [1.2, 0.45, 0.45, 0.95, 3.2], vib=0.15)),
            ("ch2", 8, line("night swim night swim".split(), [0, 0.75, 1.75, 2.5], [69, 66, 69, 73], [0.7, 0.95, 0.7, 3.4], vib=0.15)),
            ("ch3", 8, line("the whole sky be- low us".split(), [0, 0.25, 1.25, 2.5, 3, 3.75], [64, 66, 71, 69, 66, 62], [0.2, 0.95, 1.2, 0.45, 0.7, 3.0], fall=0.5)),
            ("ch4", 8, line("night swim night swim".split(), [0, 0.75, 1.75, 2.5], [69, 66, 69, 74], [0.7, 0.95, 0.7, 0.9])
                + [N("~", 3.5, 0.5, 73), N("~", 4, 0.5, 71), N("~", 4.5, 2.5, 69, vib=0.2)]),
            ("br", 8, line("I don't want to go home yet".split(), [0, 0.25, 0.75, 1.25, 1.5, 2, 3.25], [57, 59, 62, 62, 61, 59, 57], [0.2, 0.45, 0.45, 0.2, 0.45, 1.2, 2.4], fall=1.0)),
            ("echo", 4, line("night swim".split(), [0, 0.75], [57, 54], [0.7, 2.2], fall=0.5), {"voice": "bm_lewis"}),
            *chops(62, ["swim", "night", "stay", "oh", "ah", "mm"]),
            ("hold", 4, [N("ooh", 0, 3.8, 62, vib=0.12)]),
        ],
    ),
    # Kite Season, E major at 146 sung half-time and low (G#3-A4) in a dry
    # alto. Verse E-C#m-F#m-G#m, chorus A-E/G#-C#m-B, the bridge C#m7-Amaj7-
    # F#m7-Bsus, all in key. Lines are two bars, written to the speech rhythm by hand:
    # pickups, long vowels on the stressed words, rests between phrases.
    "kite-season-vox": dict(
        title="Kite Season Vox", voice="bf_emma", bpm=146, speed=0.8, root=64, human=0.25,
        parts=[
            ("v1", 8, line("red string tied to a card- board kite".split(), [0, 0.5, 1, 2, 2.5, 2.75, 3.5, 4.5], [59, 59, 61, 63, 61, 59, 61, 56], [0.45, 0.45, 0.9, 0.45, 0.25, 0.7, 0.9, 2.2], fall=0.5)),
            ("v2", 8, line("your fing- ers cold so I hold the line".split(), [0, 0.25, 1, 1.5, 2.5, 3, 3.5, 4.5, 5], [59, 61, 59, 56, 59, 61, 63, 61, 59], [0.25, 0.7, 0.45, 0.9, 0.45, 0.45, 0.9, 0.45, 2.0])),
            ("v3", 8, line("the sea keeps fold- ing its white sheets".split(), [0, 0.5, 1.5, 2, 2.5, 3, 3.5, 4.5], [61, 63, 64, 63, 61, 59, 61, 63], [0.4, 0.9, 0.45, 0.45, 0.45, 0.45, 0.9, 2.2], vib=0.12)),
            ("v4", 8, line("and we lean back in- to the wind".split(), [0, 0.25, 0.5, 1.5, 2.5, 3, 3.25, 4], [56, 57, 59, 61, 59, 57, 56, 56], [0.25, 0.25, 0.9, 0.9, 0.45, 0.25, 0.6, 2.6], fall=1.0)),
            ("v5", 8, line("sand in the pa- ges of your book".split(), [0, 1, 1.25, 1.5, 2, 2.5, 2.75, 3.5], [64, 63, 61, 63, 61, 59, 61, 59], [0.9, 0.25, 0.25, 0.45, 0.45, 0.25, 0.6, 2.5])),
            ("v6", 8, line("a dog runs cir- cles in the foam".split(), [0, 0.25, 1, 1.5, 2, 2.5, 2.75, 3.5], [59, 61, 63, 64, 63, 61, 59, 61], [0.25, 0.7, 0.45, 0.45, 0.45, 0.25, 0.6, 2.5], fall=0.5)),
            ("v7", 8, line("you count the knots out loud to me".split(), [0, 0.5, 1, 1.5, 2.5, 3, 3.5, 4], [61, 61, 59, 61, 63, 64, 63, 61], [0.45, 0.45, 0.45, 0.9, 0.45, 0.45, 0.45, 2.4])),
            ("v8", 8, line("nine ten e- lev- en gone".split(), [0, 1, 2, 2.25, 2.75, 4], [63, 61, 59, 61, 63, 56], [0.9, 0.9, 0.25, 0.45, 0.9, 2.8], fall=1.0)),
            ("ch1", 8, line("high- er than the kites".split(), [0, 0.75, 1.5, 2, 2.5], [64, 68, 66, 64, 68], [0.7, 0.7, 0.45, 0.45, 4.6], vib=0.15)),
            ("ch2", 8, line("high- er than we'll ev- er be".split(), [0, 0.75, 1.5, 2, 2.5, 3, 3.5], [64, 68, 69, 68, 66, 64, 66], [0.7, 0.7, 0.45, 0.45, 0.45, 0.45, 3.8], vib=0.15)),
            ("ch3", 8, line("don't let go".split(), [0, 1, 2], [69, 68, 66], [0.9, 0.9, 1.4])
                + [N("~", 3.5, 0.5, 64), N("~", 4, 3, 63, vib=0.2)]),
            ("ch4", 8, line("the sky is pull- ing on your sleeve".split(), [0, 0.25, 1, 1.5, 2, 2.5, 2.75, 3.5], [61, 64, 64, 66, 64, 63, 61, 59], [0.25, 0.7, 0.45, 0.45, 0.45, 0.25, 0.6, 4.0], fall=0.5)),
            ("br", 8, line("we were nev- er meant to land".split(), [0, 0.25, 1, 1.5, 2, 3, 3.5], [56, 57, 59, 61, 59, 57, 56], [0.25, 0.6, 0.45, 0.45, 0.9, 0.45, 4.0], fall=1.0)),
            ("echo", 4, line("high- er".split(), [0, 0.75], [52, 56], [0.7, 2.6], fall=0.5), {"voice": "bm_lewis"}),
            *chops(64, ["high", "go", "kite", "oh", "ah", "mm"]),
            ("hold", 4, [N("ooh", 0, 3.8, 64, vib=0.12)]),
        ],
    ),
    # Bubble Wrap, Bb major at 100. A plain, conversational verse low in the
    # voice (F3-Eb4) over Eb-F-Gm-Dm, a deadpan low male chant that adds a
    # term each pass, a double-time chorus on Gm7-Eb-Bb/D-F up to G4, and a
    # held ballad breakdown. The chops sit on Bb4 for chipmunk riffs.
    "candy-fault-vox": dict(
        # Candy Fault's topline note for note, a 4th below where the demo writes it
        # (the demo sounds in B); the final chorus lines are sung
        # a half step up (the song lifts at bar 56) so the book never re-pitches.
        # Lines whisper misheard read their words slower (same notes).
        title="Candy Fault Vox", voice="bf_emma", bpm=156, speed=0.8, root=75,
        parts=[
            ("v1a", 7, line("pink light on low bat- ter- y".split(), [0, 0.5, 1.5, 2, 3, 3.5, 4], [63, 63, 61, 63, 66, 64, 63], [0.421, 0.7, 0.421, 0.9, 0.421, 0.45, 1.7], vib=0.12), {"speed": 0.6}),
            ("v1b", 7, line("I keep you in my cache".split(), [0, 0.5, 1.5, 2, 2.5, 3.5], [59, 64, 63, 66, 68, 66], [0.4, 0.7, 0.421, 0.421, 0.421, 1.9], vib=0.12)),
            ("v1c", 7, line("sug- ar on the cir- cuit board".split(), [0, 0.5, 1, 1.5, 2, 3, 3.5], [63, 63, 66, 68, 71, 70, 66], [0.4, 0.4, 0.421, 0.421, 0.9, 0.45, 1.8], vib=0.12)),
            ("v1d", 6, line("ev- ery kiss a lit- tle crash".split(), [0, 0.5, 1, 2, 2.5, 3, 3.5], [66, 68, 70, 68, 66, 68, 70], [0.4, 0.4, 0.9, 0.421, 0.421, 0.45, 1.5], vib=0.12)),
            ("lift1", 7, line("turn it up un- til it breaks".split(), [0, 0.5, 1, 2, 2.5, 3, 4], [68, 68, 71, 68, 71, 73, 73], [0.4, 0.4, 0.9, 0.4, 0.4, 0.421, 1.6], vib=0.12), {"speed": 0.6}),
            ("lift2", 8, line("hold on tight to me".split(), [0, 1, 2, 3.5, 4], [71, 73, 75, 73, 76], [0.7, 0.7, 1.2, 0.45, 2.4], vib=0.12)),
            ("chA", 8, line("we glow ~ in the sta- tic oh ~".split(), [0, 0.5, 1, 2, 2.5, 3, 4, 4.5, 5.5], [66, 73, 71, 68, 70, 71, 70, 68, 66], [0.45, 0.5, 1, 0.4, 0.4, 0.9, 0.45, 1, 1])),
            ("chB1", 7, line("sweet ~ as a short cir- cuit".split(), [0, 1, 1.5, 2, 2.5, 3.5, 4.5], [73, 71, 68, 71, 75, 73, 71], [1, 0.5, 0.4, 0.4, 0.9, 0.85, 1.5], vib=0.12)),
            ("chA2", 8, line("we glow ~ in the sta- tic oh ~ oh".split(), [0, 0.5, 1, 2, 2.5, 3, 4, 4.5, 5.25, 6], [66, 73, 71, 68, 70, 71, 70, 68, 66, 73], [0.45, 0.5, 1, 0.4, 0.4, 0.9, 0.45, 0.75, 0.5, 1])),
            ("chC1", 6, line("break me in- to pix- els ~".split(), [0, 0.75, 1.5, 2, 2.5, 3, 4.5], [75, 75, 73, 71, 78, 75, 73], [0.7, 0.6, 0.4, 0.4, 0.45, 1.5, 0.5])),
            ("v2a", 7, line("blue screen in the morn- ing light".split(), [0, 0.5, 1.5, 2, 3, 3.5, 4], [63, 63, 61, 63, 66, 64, 63], [0.421, 0.7, 0.421, 0.9, 0.421, 0.45, 1.7], vib=0.12)),
            ("v2b", 7, line("you're buf- fer- ing my heart".split(), [0, 0.5, 1.5, 2, 2.5, 3.5], [59, 64, 63, 66, 68, 66], [0.4, 0.7, 0.421, 0.421, 0.421, 1.9], vib=0.12)),
            ("v2c", 7, line("can- dy coat- ed er- ror code".split(), [0, 0.5, 1, 1.5, 2, 3, 3.5], [63, 63, 66, 68, 71, 70, 66], [0.4, 0.4, 0.421, 0.421, 0.9, 0.45, 1.8], vib=0.12)),
            ("v2d", 6, line("I don't want it to re- start".split(), [0, 0.5, 1, 2, 2.5, 3, 3.5], [64, 66, 69, 66, 64, 66, 69], [0.4, 0.4, 0.9, 0.421, 0.421, 0.45, 1.5], vib=0.12)),
            ("chB2", 7, line("su- gar rush on a live wire".split(), [0, 1, 1.5, 2.5, 3, 3.5, 4.5], [73, 71, 68, 71, 73, 75, 71], [1, 0.45, 0.9, 0.4, 0.4, 0.85, 1.5], vib=0.12)),
            ("chC2", 6, line("burn me sweet- er high- er ~".split(), [0, 0.75, 1.5, 2, 2.5, 3, 4.5], [75, 75, 73, 71, 78, 75, 73], [0.7, 0.6, 0.4, 0.4, 0.45, 1.5, 0.5]), {"speed": 0.6}),
            ("br1", 24, line("slow down ~ let ~ the ~ col- ors run ~".split(), [0, 1, 4.5, 7, 8.5, 11, 12.5, 15, 16.5, 19, 20.5], [68, 68, 66, 66, 64, 64, 63, 63, 61, 61, 59], [1, 3.5, 2.5, 1.5, 2.5, 1.5, 2.5, 1.5, 2.5, 1.5, 2.5], vib=0.12), {"speed": 0.7}),
            ("br2", 7, line("hold the light till it's un- done".split(), [0, 0.5, 1, 2, 2.5, 3, 4.5], [64, 66, 68, 68, 71, 71, 70], [0.4, 0.4, 1, 0.4, 0.4, 1.5, 1.4], vib=0.12), {"speed": 0.7}),
            ("chAo", 7, line("we glow ~ in the sta- tic oh ~".split(), [0, 0.5, 0.9, 1.5, 2, 2.5, 3.5, 4, 5], [67, 74, 72, 69, 71, 72, 71, 69, 67], [0.4, 0.4, 0.6, 0.4, 0.4, 0.9, 0.45, 1, 1])),
            ("chBo", 7, line("sweet ~ as a short cir- cuit".split(), [0, 1, 1.5, 2, 2.5, 3.5, 4.5], [74, 72, 69, 72, 76, 74, 72], [1, 0.5, 0.4, 0.4, 0.9, 0.85, 1.5], vib=0.12)),
            ("chA2o", 8, line("we glow ~ in the sta- tic oh ~ oh".split(), [0, 0.5, 1, 2, 2.5, 3, 4, 4.5, 5.25, 6], [67, 74, 72, 69, 71, 72, 71, 69, 67, 74], [0.45, 0.5, 1, 0.4, 0.4, 0.9, 0.45, 0.75, 0.5, 1])),
            ("chCo", 9, line("break me in- to pix- els ~ ~".split(), [0, 0.75, 1.5, 2, 2.75, 3, 4.5, 6.5], [76, 76, 74, 72, 79, 76, 74, 72], [0.7, 0.6, 0.4, 0.221, 0.2, 1.5, 2, 1.5], vib=0.12)),
            ("last", 14, line("we glow in the sta- tic oh".split(), [0, 0.5, 4, 4.5, 5, 6, 7.5], [64, 67, 69, 71, 72, 71, 72], [0.45, 1.4, 0.4, 0.4, 1, 0.45, 5.5], vib=0.12), {"speed": 0.6}),
            *chops(75, ["pix", "me", "oh"]),
        ],
    ),
    "bubble-wrap-vox": dict(
        title="Bubble Wrap Vox", voice="bf_emma", bpm=100, root=70, human=0.25,
        parts=[
            ("v1", 8, line("I wrapped my heart in bub- ble wrap".split(), [0, 0.25, 0.75, 1, 1.5, 2, 2.5, 3], [58, 60, 58, 62, 60, 58, 57, 58], [0.25, 0.45, 0.25, 0.45, 0.45, 0.45, 0.45, 1.5])),
            ("v2", 8, line("and left it on your front step".split(), [0, 0.25, 0.75, 1, 1.5, 1.75, 2.25], [57, 58, 60, 60, 58, 57, 55], [0.25, 0.45, 0.25, 0.45, 0.25, 0.45, 1.8], fall=0.5)),
            ("v3", 8, line("you nev- er signed for it".split(), [0, 0.5, 0.75, 1.25, 2, 2.25], [62, 63, 62, 60, 58, 60], [0.45, 0.25, 0.45, 0.7, 0.25, 1.5])),
            ("v4", 8, line("so it's still sit- ting there".split(), [0, 0.25, 0.5, 1, 1.5, 2], [58, 58, 60, 62, 60, 57], [0.25, 0.25, 0.45, 0.45, 0.45, 2.2], fall=0.5)),
            ("v5", 8, line("it rained a lit- tle on the box".split(), [0, 0.25, 0.75, 1, 1.5, 1.75, 2, 2.5], [62, 62, 60, 62, 63, 62, 60, 58], [0.25, 0.45, 0.25, 0.45, 0.25, 0.25, 0.45, 1.6])),
            ("v6", 8, line("I watched it from the bus stop".split(), [0, 0.25, 0.75, 1, 1.5, 1.75, 2.25], [57, 58, 60, 58, 57, 55, 53], [0.25, 0.45, 0.25, 0.45, 0.25, 0.45, 1.8], fall=0.5)),
            ("v7", 8, line("the light in your win- dow went out".split(), [0, 0.25, 0.75, 1, 1.25, 1.75, 2.25, 2.75], [58, 60, 62, 62, 63, 62, 60, 62], [0.25, 0.45, 0.25, 0.25, 0.45, 0.45, 0.45, 1.6])),
            ("v8", 8, line("I'm not mad I'm just say- ing".split(), [0, 0.5, 1, 1.75, 2, 2.5, 2.75], [60, 60, 62, 58, 58, 57, 55], [0.45, 0.45, 0.7, 0.25, 0.45, 0.25, 1.6], fall=0.5)),
            ("chant1", 4, line("frag- ile".split(), [0, 1], [50, 46], [0.7, 0.9]), {"voice": "bm_lewis"}),
            ("chant2", 4, line("this side up".split(), [0, 1, 2], [50, 50, 55], [0.6, 0.6, 1.2]), {"voice": "bm_lewis"}),
            ("chant3", 4, line("han- dle with care".split(), [0, 0.5, 1, 2], [50, 50, 50, 46], [0.45, 0.45, 0.7, 0.9]), {"voice": "bm_lewis"}),
            ("chant4", 4, line("do not bend".split(), [0, 1, 2], [53, 50, 46], [0.7, 0.7, 0.9]), {"voice": "bm_lewis"}),
            ("ch1", 8, line("pop pop noth- ing in- side".split(), [0, 0.5, 1.5, 2, 2.5, 2.75], [65, 65, 62, 63, 62, 60], [0.3, 0.45, 0.45, 0.45, 0.25, 2.2], fall=0.5)),
            ("ch2", 8, line("press a lit- tle and it's there".split(), [0, 0.5, 0.75, 1.25, 1.75, 2, 2.5], [62, 62, 63, 65, 63, 62, 65], [0.45, 0.25, 0.45, 0.45, 0.25, 0.45, 2.8], vib=0.12)),
            ("ch3", 8, line("pop pop I don't care".split(), [0, 0.5, 1.5, 2, 2.5], [65, 65, 67, 65, 63], [0.3, 0.45, 0.45, 0.45, 2.2], vib=0.15)),
            ("ch4", 8, line("you can keep it if you want".split(), [0, 0.25, 0.75, 1.25, 1.5, 1.75, 2.25], [62, 62, 63, 62, 60, 58, 60], [0.25, 0.45, 0.45, 0.25, 0.25, 0.45, 2.6], fall=0.5)),
            ("br1", 8, line("o- pen it slow".split(), [0, 1, 2, 3], [63, 65, 67, 65], [0.9, 0.9, 0.9, 4.5], vib=0.18)),
            ("br2", 8, line("it's all I had to send".split(), [0, 0.5, 1, 2, 2.5, 3], [62, 63, 65, 63, 62, 60], [0.45, 0.45, 0.9, 0.45, 0.45, 4.2], scoop=0.5)),
            *chops(70, ["pop", "up", "oh", "ah", "hey", "mm"]),
            ("hold", 4, [N("ooh", 0, 3.8, 70, vib=0.12)]),
        ],
    ),
    # Glow Stick, Db major at 128: twee house-pop. The verse talks low (Ab3-F4)
    # over Bbm7-Gb | Db/F-Ab, the chorus opens to Ab4 over Gb-Ab-Fm-Bbm and
    # its hook changes on the last repeat; the break is plain and drumless.
    "glow-stick-vox": dict(
        title="Glow Stick Vox", voice="bf_emma", bpm=128, speed=0.8, root=61, human=0.25,
        parts=[
            ("v1", 8, line("you found me in your coat a- gain".split(), [0, 0.25, 1, 1.25, 1.5, 2, 3, 3.5], [58, 61, 61, 60, 58, 61, 60, 58], [0.25, 0.7, 0.25, 0.25, 0.45, 0.9, 0.45, 2.6], fall=0.5)),
            ("v2", 8, line("still in the wrap- per from last June".split(), [0, 0.5, 0.75, 1, 1.5, 2, 2.5, 3], [61, 60, 58, 61, 63, 61, 60, 56], [0.45, 0.25, 0.25, 0.45, 0.45, 0.45, 0.45, 2.4], fall=0.5)),
            ("v3", 8, line("you said you don't keep things like me".split(), [0, 0.25, 1, 1.25, 1.75, 2.5, 3, 3.5], [61, 63, 61, 60, 61, 63, 65, 61], [0.25, 0.7, 0.25, 0.45, 0.7, 0.45, 0.45, 2.4])),
            ("v4", 8, line("then you held me up to the light".split(), [0, 0.25, 0.5, 1.5, 1.75, 2.5, 2.75, 3], [56, 58, 61, 60, 58, 56, 58, 56], [0.25, 0.25, 0.9, 0.25, 0.7, 0.25, 0.25, 2.8], fall=1.0)),
            ("v5", 8, line("the floor is shak- ing in the hall".split(), [0, 0.25, 1, 1.5, 1.75, 2.5, 2.75, 3], [61, 61, 63, 65, 63, 61, 60, 61], [0.25, 0.7, 0.45, 0.25, 0.7, 0.25, 0.25, 2.6])),
            ("v6", 8, line("your friends are danc- ing on the stairs".split(), [0, 0.25, 0.75, 1.5, 1.75, 2.5, 2.75, 3], [60, 61, 63, 61, 60, 58, 60, 56], [0.25, 0.45, 0.7, 0.25, 0.7, 0.25, 0.25, 2.4], fall=0.5)),
            ("v7", 8, line("I'm green in- side your o- pen palm".split(), [0, 0.5, 1.5, 1.75, 2.25, 2.75, 3, 3.5], [61, 63, 61, 63, 65, 63, 61, 61], [0.45, 0.9, 0.25, 0.45, 0.45, 0.25, 0.45, 2.4])),
            ("v8", 8, line("I'll glow as long as you hold on".split(), [0, 0.5, 1, 1.5, 2.5, 2.75, 3, 3.5], [63, 63, 65, 68, 65, 63, 61, 63], [0.45, 0.45, 0.45, 0.9, 0.25, 0.25, 0.45, 2.6], vib=0.12)),
            ("ch1", 8, line("bend me and I'll glow".split(), [0, 0.75, 1.5, 2, 3.5], [66, 65, 63, 65, 68], [0.7, 0.7, 0.5, 0.7, 2.6], vib=0.15), {"speed": 0.6}),
            ("ch2", 8, line("I'll be bright for you".split(), [0, 0.5, 1, 2.5, 3], [63, 65, 68, 65, 61], [0.45, 0.45, 1.2, 0.45, 2.6], fall=0.5)),
            ("ch3", 8, line("bend me and I'll glow".split(), [0, 0.75, 1.5, 2, 3.5], [66, 65, 63, 65, 70], [0.7, 0.7, 0.5, 0.7, 2.6], vib=0.15), {"speed": 0.6}),
            ("ch4", 8, line("bend me till I'm gone".split(), [0, 0.75, 1.5, 2, 3.5], [68, 66, 65, 63, 61], [0.7, 0.7, 0.5, 0.7, 2.6], fall=1.0)),
            ("br1", 8, line("it's on- ly ev- er once".split(), [0, 0.5, 1, 2, 2.5, 3], [58, 61, 60, 58, 58, 56], [0.45, 0.45, 0.9, 0.45, 0.45, 4.4], air=0.3)),
            ("br2", 8, line("and I want it to be you".split(), [0, 0.25, 0.75, 1.25, 1.5, 2, 2.5], [60, 61, 63, 61, 60, 63, 61], [0.25, 0.45, 0.45, 0.25, 0.45, 0.45, 4.6], scoop=0.5)),
            ("last", 12, line("bend me till I'm gone".split(), [0, 0.75, 1.5, 2, 3.5], [68, 66, 65, 63, 65], [0.7, 0.7, 0.45, 0.9, 1.4])
                + [N("~", 5, 1, 63), N("~", 6, 5, 61, vib=0.15)]),
            *chops(61, ["glow", "oh", "ah", "hey", "mm"]),
            ("hold", 4, [N("ooh", 0, 3.8, 61, vib=0.12)]),
        ],
    ),
    # Window Seat, G major at 170 sung half-time: breakbeat dream-pop. Verses
    # sit low (G3-E4) over Am7-Cmaj7-Em7-D, two bars of 170 to a line; the
    # chorus is four long words a phrase over G-D/F#-Em7-Cmaj7, up to B4.
    "window-seat-vox": dict(
        title="Window Seat Vox", voice="bf_emma", bpm=170, speed=0.8, root=67, human=0.25,
        parts=[
            ("v1", 16, line("the bus is warm the lights go by".split(), [0, 1, 2, 3, 5, 6, 7, 8], [60, 60, 62, 64, 62, 60, 59, 57], [0.9, 0.9, 0.9, 1.8, 0.9, 0.9, 0.9, 5], fall=0.5)),
            ("v2", 16, line("I draw a door in- side the fog".split(), [0, 1, 2, 3, 5, 6, 7, 8], [59, 60, 62, 64, 64, 62, 60, 62], [0.9, 0.9, 0.9, 1.8, 0.9, 0.9, 0.9, 5])),
            ("v3", 16, line("a lit- tle door for you to use".split(), [0, 0.5, 1, 2, 4, 5, 6, 7], [64, 64, 62, 64, 66, 67, 66, 64], [0.45, 0.45, 0.9, 1.8, 0.9, 0.9, 0.9, 6])),
            ("v4", 16, line("it fades be- fore I'm home a- gain".split(), [0, 1, 2, 3, 4, 6, 7, 8], [62, 60, 59, 60, 62, 59, 57, 55], [0.9, 0.9, 0.9, 0.9, 1.8, 0.9, 0.9, 6], fall=1.0)),
            ("v5", 16, line("I count the trees a- long the line".split(), [0, 1, 2, 3, 5, 6, 7, 8], [60, 62, 64, 67, 66, 64, 62, 64], [0.9, 0.9, 0.9, 1.8, 0.9, 0.9, 0.9, 5])),
            ("v6", 16, line("my head a- gainst the cold win- dow".split(), [0, 1, 2, 3, 4, 5, 6, 7], [59, 60, 62, 64, 62, 64, 62, 60], [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 6], fall=0.5)),
            ("v7", 16, line("I'm half a- sleep and half with you".split(), [0, 1, 2, 3, 5, 6, 7, 8], [64, 64, 62, 64, 66, 67, 69, 67], [0.9, 0.9, 0.9, 1.8, 0.9, 0.9, 0.9, 5], vib=0.12)),
            ("v8", 16, line("and both of them are fine with me".split(), [0, 0.5, 1, 2, 3, 4, 6, 7], [62, 64, 66, 67, 66, 64, 62, 62], [0.45, 0.45, 0.9, 0.9, 0.9, 1.8, 0.9, 6], vib=0.12)),
            ("ch1", 16, line("win- dow seat".split(), [0, 1.5, 2], [71, 69, 67], [1.2, 0.5, 4.5], vib=0.15)),
            ("ch2", 16, line("I'll draw you in the fog".split(), [0, 1, 3, 4, 5, 6], [66, 67, 69, 67, 66, 64], [0.9, 1.8, 0.9, 0.9, 0.9, 4], fall=0.5)),
            ("ch3", 16, line("win- dow seat".split(), [0, 1.5, 2], [71, 72, 71], [1.2, 0.5, 4.5], vib=0.15)),
            ("ch4", 16, line("come draw me in the fog".split(), [0, 1, 3, 4, 5, 6], [69, 71, 69, 67, 66, 67], [0.9, 1.8, 0.9, 0.9, 0.9, 4], fall=1.0), {"speed": 0.6}),
            ("br1", 16, line("I don't want to get home".split(), [0, 1, 2, 3, 4, 6], [59, 60, 62, 60, 59, 57], [0.9, 0.9, 0.9, 0.9, 1.8, 4], air=0.3)),
            ("br2", 16, line("just ride with me a- while".split(), [0, 1, 2, 3, 4, 5], [62, 64, 66, 67, 66, 64], [0.9, 0.9, 0.9, 0.9, 0.9, 4], scoop=0.5)),
            ("last", 24, line("come draw me in the fog".split(), [0, 1, 3, 4, 5, 6], [69, 71, 69, 67, 66, 69], [0.9, 1.8, 0.9, 0.9, 0.9, 3.5])
                + [N("~", 10, 2, 67), N("~", 12, 10, 66, vib=0.15)]),
            *chops(67, ["oh", "ah", "seat", "hey", "mm"]),
            ("hold", 8, [N("ah", 0, 7.8, 67, vib=0.12)]),
        ],
    ),
    "light-one-vox": dict(
        title="Light One Vox", voice="bf_emma", bpm=122, speed=0.8, root=65, human=0.25,
        parts=[
            ("v1", 8, line("the door was o- pen so I came".split(), [0, 0.5, 1, 1.5, 2, 3, 3.5, 4], [57, 57, 60, 62, 60, 57, 55, 57], [0.45, 0.45, 0.45, 0.45, 0.9, 0.45, 0.45, 2.6], fall=0.5)),
            ("v2", 8, line("I put a coin in- side the tin".split(), [0, 0.5, 1, 1.5, 2.5, 3, 3.5, 4], [55, 57, 58, 60, 58, 57, 55, 57], [0.45, 0.45, 0.45, 0.9, 0.45, 0.45, 0.45, 2.6])),
            ("v3", 8, line("I'm not the kind to kneel or pray".split(), [0, 0.5, 1, 1.5, 2, 3, 3.5, 4], [60, 60, 62, 64, 62, 60, 58, 57], [0.45, 0.45, 0.45, 0.45, 0.9, 0.45, 0.45, 2.6])),
            ("v4", 8, line("but you would like the qui- et here".split(), [0, 0.5, 1, 1.5, 2, 2.5, 3, 4], [57, 58, 60, 62, 60, 58, 57, 55], [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.9, 2.6], fall=0.5)),
            ("v5", 8, line("the wax is warm a- gainst my thumb".split(), [0, 0.5, 1, 1.5, 2, 3, 3.5, 4], [57, 57, 60, 62, 62, 60, 57, 60], [0.45, 0.45, 0.45, 0.45, 0.9, 0.45, 0.45, 2.6])),
            ("v6", 8, line("a lit- tle flame for ev- ery year".split(), [0, 0.5, 1, 1.5, 2.5, 3, 3.5, 4], [55, 57, 58, 60, 62, 60, 58, 57], [0.45, 0.45, 0.45, 0.9, 0.45, 0.45, 0.45, 2.6], fall=0.5)),
            ("v7", 8, line("the bells are count- ing out the noon".split(), [0, 0.5, 1, 1.5, 2, 3, 3.5, 4], [60, 62, 64, 65, 64, 62, 60, 62], [0.45, 0.45, 0.45, 0.45, 0.9, 0.45, 0.45, 2.6])),
            ("v8", 8, line("I'm count- ing all the days with you".split(), [0, 0.5, 1, 1.5, 2, 2.5, 3, 4], [62, 64, 65, 64, 62, 60, 62, 60], [0.45, 0.45, 0.45, 0.45, 0.45, 0.45, 0.9, 2.6], fall=0.5)),
            ("ch1", 8, line("light one for me".split(), [0, 1, 1.5, 2], [69, 72, 70, 69], [0.9, 0.45, 0.45, 4.2], vib=0.15)),
            ("ch2", 8, line("when I'm too far a- way".split(), [0, 0.5, 1, 2, 2.5, 3], [67, 65, 67, 69, 67, 65], [0.45, 0.45, 0.9, 0.45, 0.45, 3.4], fall=0.5)),
            ("ch3", 8, line("light one for me".split(), [0, 1, 1.5, 2], [69, 72, 74, 72], [0.9, 0.45, 0.45, 4.2], vib=0.15)),
            ("ch4", 8, line("I'll light one for you".split(), [0, 0.5, 1, 1.5, 2], [72, 70, 69, 67, 65], [0.45, 0.45, 0.45, 0.45, 2.6], fall=1.0), {"speed": 0.6}),
            ("br1", 8, line("you don't have to be- lieve".split(), [0, 0.5, 1, 1.5, 2, 2.5], [60, 62, 64, 65, 64, 62], [0.45, 0.45, 0.45, 0.45, 0.45, 4.0], air=0.3)),
            ("br2", 8, line("you just have to come in".split(), [0, 0.5, 1, 1.5, 2, 3], [62, 64, 65, 64, 62, 60], [0.45, 0.45, 0.45, 0.45, 0.9, 4.0], scoop=0.5)),
            ("last", 12, line("light one for you".split(), [0, 1, 1.5, 2], [69, 72, 70, 72], [0.9, 0.45, 0.45, 1.4])
                + [N("~", 4, 1.5, 70), N("~", 6, 5, 69, vib=0.15)]),
            *chops(65, ["light", "oh", "ah", "one", "mm"]),
            ("hold", 8, [N("ah", 0, 7.8, 65, vib=0.12)]),
        ],
    ),
}


def render(song, out):
    bpm = song["bpm"]
    spb = 60 / bpm
    chunks, slices, cursor = [], [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for k, (name, beats, notes, *opt) in enumerate(song["parts"]):
            spec = {"voice": song["voice"], "bpm": bpm, "bars": beats / 4, "lead": LEAD,
                    "formant": song.get("formant", 0.0), "clarity": song.get("clarity", 1.0),
                    "speed": song.get("speed", 1.0), "notes": notes}
            # Optional song-wide "human" and per-part overrides (a second voice,
            # a lower formant, more humanizing) as a fourth tuple element.
            if song.get("human"):
                spec.update(human=song["human"], seed=k)
            if opt:
                spec.update(opt[0])
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
