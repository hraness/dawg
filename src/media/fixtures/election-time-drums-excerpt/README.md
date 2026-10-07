# Election Time drum excerpt

`drums.wav` is a 9.9-second excerpt of the separated drum stem of "Election Time, Funky Brass Instrumentals for Podcasts and Quiz Games" by Kjartan Abel, published on YouTube at https://www.youtube.com/watch?v=VpFi3D_EB0c under the YouTube Creative Commons Attribution license (CC BY). The stem was produced by StemDeck's Demucs `htdemucs_6s` model on 2026-09-03; the excerpt starts 2.4 seconds into the track, just before the second bar, and was downmixed to mono and resampled to 22.05 kHz 16-bit PCM with ffmpeg so the file stays small. It contains four complete bars of a 102 BPM funk groove: kick on the downbeats with syncopated pickups, snare on beats two and four, and closed hats on every eighth.

`excerpt.json` carries the matching beat grid, shifted so that 0 is the start of the excerpt, together with the excerpt window and format.

The fixture was copied from the soundfish repository (same owner) with its attribution intact. The drum classifier test in `../../notes.test.ts` classifies this audio and checks, bar by bar, that it reports two to four kicks, at least one snare, and hats on most eighths. The audio is test evidence only; `package.json` excludes `src/**/fixtures/**` from the published package.
