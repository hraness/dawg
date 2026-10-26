---
id: demos
title: Demo songs
parent: arrange
order: 0
---

Six complete, editable hyperpop songs with original patterns and
sounds, all offline. Open a song's notes to explore its production.

- Candy Fault · an abstract synth singer over glitch breaks
- Redline · F minor drum-and-bass, words over a classic vocoder
- Glass Garden · A major, tresillo blooms, syllable arps, grain voice
- Night Swim · D major house, marimba and plucks, a low sung verse
- Kite Season · E major half-time drive, organ, fuzz guitar, glide lead
- Bubble Wrap · Bb major stop-start pop, low chant, double-time chorus

Redline and Glass Garden blend a synth singer with recorded words
and play the vocal as an instrument: syllable riffs that answer each
line, stutters on chord tones, reversed swells, a looped vowel doubling
the lead and a grain cloud. `guide hyperpop` explains the techniques.
`dawg make "<brief>"` writes a new song in this style: the local model
writes the words and a seed draws the music, so each seed is a new song.

## Ask

- "find a demo with chopped vocals and show me its drop"

## Type it yourself

- `demo` opens the song shelf · `demo search drop`
- `demo info glass-garden` explains its arrangement and mix
- `demo glass-garden` loads the song and opens TAPE, paused
- `sample library` browses the bundled sounds
- `sample chop soft-reboot-vox 8` slices a vocal book into a pattern

Loading replaces the song in one undo step. Browse and read freely;
save or fork before developing another version you want to keep.
Use a `style` groove for a short backing loop to build on.

## Menu

- Ctrl-K › Arrange › demo songs › Glass Garden › load song
- Ctrl-K › Sound › sample library

## Keys

- Space plays in TAPE · Tab / Shift-Tab changes track
- `,` / `.` changes scene · `-` / `=` zooms out / in
- Click TAPE action labels to navigate · Esc returns to the prompt
- Ctrl-Z restores the song before loading

## Next

- `guide hyperpop` · `guide tape` · `guide sample-library`

```agent
Use list_demos for read-only metadata and load_demo for one planned
whole-song replacement. The same original offline songs are available
through demo commands. The studio pack is preinstalled: search_sounds
finds it, use_sound adds a hash-pinned voice, and audio slices it.
Keep the distinction between a whole demo song and a short style groove.
To write a new hyperpop song, call song_guide for the card guide, then
compose_song with a song card; a new seed gives a new song for the same
card. write_song with a classic sheet stays for editing a demo-style sheet.
Read the production notes and inspect the score before explaining a
feature. Do not describe these original patterns as recordings or copies
of commercial songs, or synthetic machine voices as human singers.
```
