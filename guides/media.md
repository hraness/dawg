---
id: media
title: Samples and media tools
parent: sound
order: 6
---

Downloads land in `tracks/<slug>/downloads/`. A missing
helper is reported with its install command; `dawg media doctor` checks.

## Ask

- "download <youtube url> and split it into stems"
- "transcribe the bass stem into notes" · "make a sample of the hook"

## Shell

- `dawg media download <url> --name hook`
- `dawg media stems <file>` vocals drums bass guitar piano other
- `dawg media analyze <file>` tempo, key, beat grid
- `dawg media notes <file> --kind bass` notes as SDK code
- `dawg media sample <file> hook --begin 0.2 --end 0.3`
- `dawg media wavetable <file> vox` · `dawg media lyrics <file>`

## In the app

- `/sample <path> as <voice>` · `/sample` lists the voices · `/sample set sn vel 0-63 rr sn` layers
