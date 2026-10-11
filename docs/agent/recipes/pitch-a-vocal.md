---
id: pitch-a-vocal
title: Pitch, trim and fade a vocal phrase
tools: [audio, analyze_pitch, comment]
---

Goal: move a vocal phrase into the song's key and make it sit cleanly.

1. Find the phrase: `segments` with silence splits a take into phrases.

```tool
{"tool":"audio","args":{"op":"segments","input":"tracks/vox/downloads/take.wav","method":"silence"}}
```

2. Cut it, then transpose with formants kept so it does not sound chipmunked.

```tool
{"tool":"audio","args":{"op":"cut","input":"tracks/vox/downloads/take.wav","from":"12.4s","to":"15.9s","output":"tracks/vox/samples/phrase.wav"}}
```

```tool
{"tool":"audio","args":{"op":"pitch","input":"tracks/vox/samples/phrase.wav","semitones":-3,"preserve":"formant"}}
```

3. Fades remove clicks at the edges; normalize sets a sane level.

```tool
{"tool":"audio","args":{"op":"fade","input":"tracks/vox/samples/phrase-pitch.wav","fadeIn":"10ms","fadeOut":"120ms"}}
```

```tool
{"tool":"audio","args":{"op":"normalize","input":"tracks/vox/samples/phrase-pitch-fade.wav","db":-1}}
```

The output names come back in each result; use them, not guesses. To check the pitch track of a vocal clip on the timeline, analyze_pitch reads it.

```dawg
dawg media chop pitch tracks/vox/samples/phrase.wav -3 --preserve formant
dawg media chop fade tracks/vox/samples/phrase.wav 10ms 120ms
```
