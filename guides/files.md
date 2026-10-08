---
id: files
title: Project files and SDK
parent: project
order: 1
---
`dawg init` writes `song.ts` and one `tracks/<slug>/track.ts` per track.
Edit them in any editor; every open window picks up the change.

## Ask
- "rewrite the drums in track.ts with a euclid kick"

## Shell
- `dawg init` · `dawg check` typecheck and evaluate, exit 1 on problems
- `dawg render out.wav` render the song to a WAV file

## In a track.ts
- `import { track, note, euclid, chord } from "dawg"`
- `notes: [note("C4", 0, 1), ...chord("Am7", 4, 4)]`
- `rhythm: [euclid("kick", 4, 16)]`

## In the app
- `/export loop.track.json` · `/import loop.track.json`
