---
id: automation
title: Automation
parent: mix
order: 1
---

Automation moves a value over time: fade a pad in, sweep a filter
open. Each moving value is a lane, and every numeric effect parameter
can have one.

## Ask

- "fade the pad in over the first four bars"
- "open the filter slowly across the loop"

## Type it yourself

Add points one at a time or several at once (beat:value):

- `automate volume at 0 0.2` · `automate volume at 4 1`
- `automate filter points 0:400 4:6000`
- `automate delay-mix at 4 0` · `automate filter remove 4`
- `clear filter automation` · `clear automation`

## Menu

- Ctrl-K › Mix › automation: each lane, add points, ramp, clear

## Keys

- In a lane row ←→ moves the point · `x` clears the lane

## Next

- `guide mix` · `guide resample`
