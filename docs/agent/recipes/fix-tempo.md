---
id: fix-tempo
title: Fit a loop to the song's tempo
tools: [audio, fit_sample, set_tempo]
---

Goal: a sample recorded at another tempo should play in time.

1. Measure its tempo.

```tool
{"tool":"audio","args":{"op":"beats","input":"tracks/keys/samples/loop.wav"}}
```

2. Either stretch the file itself (new file, pitch kept; rubberband when installed) by tempo or by ratio:

```tool
{"tool":"audio","args":{"op":"stretch","input":"tracks/keys/samples/loop.wav","fromBpm":92,"toBpm":120}}
```

```tool
{"tool":"audio","args":{"op":"stretch","input":"tracks/keys/samples/loop.wav","ratio":0.5}}
```

3. Or keep the file and let the sampler fit it at play time, following tempo ramps too: on a sampler track whose voice is named `loop`, call fit_sample with `{"trackId":"keys","voice":"loop","bpm":92,"fitmode":"tones"}`.

Use `fitmode: "beats"` for drums (slices placed on time), `"tones"` for pads and vocals, `"repitch"` for a tape feel. Changing the song tempo instead is `set_tempo`.

```dawg
dawg media chop stretch tracks/keys/samples/loop.wav 1.25
```
