---
id: stems-to-midi
title: Split a song into stems and turn a stem into notes
tools:
  [
    split_stems,
    analyze_audio,
    transcribe_notes,
    create_track,
    add_notes,
    comment,
  ]
---

Goal: learn a bass line or a drum groove from a recording.

1. Split the downloaded wav into six stems (vocals drums bass guitar piano other) in `<file>.stems/`. This can take minutes.

```tool
{"tool":"split_stems","args":{"file":"tracks/bass/downloads/song.wav"}}
```

2. Analyze the full mix once so transcription aligns to its beat grid.

```tool
{"tool":"analyze_audio","args":{"file":"tracks/bass/downloads/song.wav"}}
```

3. Transcribe one stem, limited to the part you need (seconds).

```tool
{"tool":"transcribe_notes","args":{"file":"tracks/bass/downloads/song.wav.stems/bass.wav","kind":"bass","from":30,"to":45}}
```

4. Put the notes on a track. The transcription result lists notes in beats; copy the ones you keep into add_notes (one call per part; velocity is 0-1).

```tool
{"tool":"create_track","args":{"id":"riff","name":"Riff","instrument":"bass"}}
```

```tool
{"tool":"add_notes","args":{"trackId":"riff","notes":[{"pitch":40,"start":0,"duration":0.5,"velocity":0.8},{"pitch":43,"start":1,"duration":0.5,"velocity":0.75}]}}
```

```tool
{"tool":"comment","args":{"text":"Transcribed the bass from 0:30-0:45 of the stem and kept the main riff"}}
```

Shell form:

```dawg
dawg media stems tracks/bass/downloads/song.wav
dawg media notes tracks/bass/downloads/song.wav.stems/bass.wav
```

Pitfalls: drums transcribe as kit hits (kind "drums"); polyphonic stems ("other", "piano") are noisy, so keep only the notes that make musical sense.
