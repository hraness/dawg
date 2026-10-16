---
id: hyperpop
title: Hyperpop techniques
parent: arrange
order: 7
---

The three demo songs share one kit and one approach. The chords
barely move: a four-chord loop, often I–V–vi–IV. The interest
comes from which layers play, how they sit around the kick, and
texture.

- Sub with little attack and glide; ramped saw bass for contrast
- Pads, stabs and upper layers duck under the kick
- Chord stabs ride the off-beats; soft plucks repeat up high
- Hat-only stretches, then open hats; a muted, distorted snare
- Clicks, drops and a gamelan-like upper-mid pattern
- Vocal chops looped until they turn into a synth, echoes on the beat
- Short dropouts every few bars; chops alone over the drums
- Glide and distortion on solo leads; long echo and reverb endings

## Ask

- "make the pad pump under the kick and let the chops come in alone"

## Type it yourself

- `demo info soft-reboot` explains where each move happens
- `sample chop stay-tonight 4` slices a sung hook into playable chops
- `glide 100 legato` slides the sub · `fx duck preset pump`
- `fx duck hold on` keeps the dip down until each kick note ends
- `fx eq high 4 highfreq 8000` adds air · `fx eq mid -2 midfreq 500`
- `automate distort-drive at 0 1` · `automate distort-drive at 8 4`
- `fx delay mix 0.3` on a chop track for echoes on the beat

## Menu

- Ctrl-K › Arrange › demo songs › Soft Reboot › load song
- Ctrl-K › Effects › Delay · Reverb

## Keys

- In TAPE, click a track's M to mute it and hear a dropout

## Next

- `guide demos` · `guide chop` · `guide automation` · `guide mix`

```agent
Explain these techniques with the demo scores as evidence: inspect the
tracks and notes before describing a move. Keep harmony simple; vary
layers, ducking, effects and dropouts. The demos are original and not
copies of any artist's songs, and the sung hooks are synthetic voices.
```
