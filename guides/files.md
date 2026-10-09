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

## Type it yourself

- `dawg init` · `dawg check` · `dawg render out.wav`
- `import { track, note, euclid, chord } from "dawg"`
- `notes: [note("C4", 0, 1), ...chord("Am7", 4, 4)]`
- `export loop.track.json` · `import loop.track.json`

## Menu

- Ctrl-K › Project › export

## Keys

- Edits land as one undo step · Ctrl-Z undoes a file change

## Next

- `guide sessions` · `guide project`
