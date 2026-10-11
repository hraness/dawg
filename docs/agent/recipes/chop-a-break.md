---
id: chop-a-break
title: Chop a break into a playable sampler
tools: [download_audio, audio, inspect, comment]
---
Goal: take a drum break from a video, find its hits, slice it and play the slices from a sampler track.

1. Download once (check the brief's downloads first; never fetch the same video twice).

```tool
{"tool":"download_audio","args":{"url":"https://youtu.be/dQw4w9WgXcQ","name":"break"}}
```

2. Look before cutting: length, level and tempo. `info` is cheap; `beats` gives bpm and beat times.

```tool
{"tool":"audio","args":{"op":"info","input":"tracks/drums/downloads/break.wav"}}
```

```tool
{"tool":"audio","args":{"op":"beats","input":"tracks/drums/downloads/break.wav"}}
```

3. Find the hits. `onsets` lists times in seconds; use them to pick a 1-2 bar region.

```tool
{"tool":"audio","args":{"op":"onsets","input":"tracks/drums/downloads/break.wav"}}
```

4. Cut the bar you want (cuts snap to zero crossings), then slice it at its onsets straight into a sampler track. `pattern` also writes notes that replay the slices in order.

```tool
{"tool":"audio","args":{"op":"cut","input":"tracks/drums/downloads/break.wav","from":"1.2s","to":"3.4s","output":"tracks/drums/samples/break-bar.wav"}}
```

```tool
{"tool":"audio","args":{"op":"slice","input":"tracks/drums/samples/break-bar.wav","method":"onset","count":8,"track":"drums","pattern":true}}
```

5. Check the result without growing the brief, then leave a comment.

```tool
{"tool":"inspect","args":{"what":"track","target":"drums"}}
```

```tool
{"tool":"comment","args":{"text":"Chopped the break into 8 onset slices on drums; pattern replays them in order #chop"}}
```

The same chain from a shell (a coding agent in another terminal):

```dawg
dawg media chop onsets tracks/drums/downloads/break.wav
dawg media chop cut tracks/drums/downloads/break.wav 1.2s 3.4s --out tracks/drums/samples/break-bar.wav
dawg media chop slice tracks/drums/samples/break-bar.wav 8 --method onset
```

Pitfalls: every edit writes a new file, so keep `output` names meaningful; `slice --track` needs the track to exist (create_track with instrument "user" or a sampler voice first if it does not).
