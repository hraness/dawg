---
id: performance
title: Performance and expression
parent: sound
order: 7
---

How notes are played: articulation, glides, bends, pedal and feel.
Targets are `all` (default), `bar 3`, `bars 2-4` or note ids.

## Ask

- "make the bass slide like a 303" · "ghost the off-beat hats"
- "pedal the piano every bar" · "humanize the drums a little"
- "play the piano una corda" · "hold the bass note with sostenuto"

## Type it yourself

- `art staccato|legato|accent|tenuto|marcato|ghost [target]`
- `glide 60ms legato` per track · `glide 60ms bar 2` per note
- `bend scoop|fall|doit|-200 [target]` · `vibrato 5.5 30 0.2`
- `pedal 0-3.5 4-7.5` (beats) · `pedal bars` · `pedal off`
- `pedal soft 0-8` una corda · `pedal sost 0-4` holds keys down at 0
- `velcurve soft|hard|fixed 0.7` · `humanize 8 5 10 seed 3`

## Menu

- Ctrl-K › Sound › performance (`/menu performance`)
