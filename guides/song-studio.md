---
id: song-studio
title: Song studio
order: 0
---

Describe a song, watch its tracks develop, and listen while the agent
works. The current house style is detailed hyperpop with actual words
sung by stock British bf_emma. Saved songs play offline.

## Ask

- “Write bright hyperpop about a phone left on a train”
- “Recreate my reference, singing its actual lyrics with bf_emma”
- “Bring the words forward and change the second chorus”

## Type it yourself

- `dawg make "bright hyperpop about a train"` runs the original driver
- `dawg workflow list` · `dawg workflow status --json`
- `dawg reference prepare <file-or-URL>` keeps source and timing
  evidence
- `dawg reference recreate <printed-manifest>` makes stock vocal + A/B
- `dawg vocals setup` · `dawg reference setup` explain dependencies
- A failed make prints its saved chart's exact `--from` resume command

## Menu

- The player has Play/Pause, Tracks, Pin, Follow and section buttons
- The agent handles sounds, effects and mix parameters

## Keys

- Space plays/pauses; the first coherent draft starts automatically
- Ctrl-T all tracks · click a track to inspect · Ctrl-P pin/unpin
- Page Up/Down inspect time · Follow returns to the moving cursor
- Alt-Left/Right seek · Enter sends/steers · Esc cancels · Ctrl-O chat
- Pause and seek win over late automatic playback; drafts stay saved

## Next

- [Full workflow and recovery guide](../docs/song-studio.md)

- `dawg workflow read original-house` includes house/chart/vocal
  guidance
- Read `reference-study` or `recreate-source` for the selected workflow
- Saved, ready, rendering and audible are separate states
- Pitch/timing measurements do not prove word clarity or exact tone

```agent
Read workflow_catalog resources for the selected versioned workflow.
perform_chart instrumental=true commits a labeled early draft; sing_chart
sings actual original words; perform_chart attaches the accepted local take.
prepare_reference and recreate_reference_vocal preserve source provenance,
actual lyrics, editable melody and aligned source/stock comparisons. Rebuild
accompaniment from retained stems. Respect listener pause, seek and pin.
```
