---
id: files
title: Project files and SDK
parent: project
order: 1
---

A dawg project is plain TypeScript you can open in any editor.
`dawg init` writes `song.ts` and one `tracks/<slug>/track.ts` per
track; every open window picks up your edits.

## Ask

- "rewrite the drums in track.ts with a euclid kick"

## Type it yourself

- Shell: `dawg init` · `dawg check` · `dawg render out.wav`
- Prompt: `export loop.track.json` · `import loop.track.json`

In a track file:

- `import { track, note, euclid, chord } from "dawg"`
- `notes: [note("C4", 0, 1), ...chord("Am7", 4, 4)]`

## Menu

- Ctrl-K › Project › export

## Keys

- A saved file lands as one undo step; Ctrl-Z undoes it

## Next

- `guide sessions` · `guide project`
