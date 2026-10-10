---
id: media
title: Samples and media tools
parent: sound
order: 4
---

Bring in outside audio: split a song into stems, find its notes, or
cut a sample from it. Downloads land in `tracks/<slug>/downloads/`.

## Ask

- "download <url> and split it into stems"
- "make a sample of the hook"

## Type it yourself

In a shell:

- `dawg media stems <file>` vocals drums bass guitar piano other
- `dawg media analyze <file>` · `dawg media notes <file> --kind bass`
- `dawg media sample <file> hook --begin 0.2 --end 0.3`

At the prompt:

- `sample <path> as <sample>` · `sample` lists the track's samples

## Menu

- Ctrl-K › Sound › instruments › use a sample · sample packs

## Keys

- Enter on a sample auditions it · Esc back

## Next

- Tip: a missing helper prints its install command; `dawg media doctor`
  checks them all
- `guide resample` · `guide voice`
