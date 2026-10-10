---
id: audio
title: Audio output and input
parent: project
order: 3
---

Pick which speakers and microphone dawg uses, or leave it on the
system default. The choice is saved on this machine, not in the song.

## Ask

- "which audio output am I using?"

## Type it yourself

- `audio` shows the devices · `audio test` plays a tone, meters input
- `audio out USB Audio Interface` · `audio out default`
- `audio in Built-in Microphone`

## Menu

- Ctrl-K › Project › audio › output · input · test

## Keys

- In a device list arrows move, Enter picks (a soft blip plays), Esc
  goes back

## Next

- Careful: device choice needs the native sink; `dawg doctor` checks it
- Unplugged mid-song: playback moves to the default and says so once
- `DAWG_AUDIO_DEVICE` overrides the choice · `guide project`
