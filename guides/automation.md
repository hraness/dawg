---
id: automation
title: Automation
parent: sound
order: 3
---
A lane moves a value over beats. Every numeric effect parameter has one.

## Ask
- "fade the pad in over the first four bars"
- "open the filter slowly across the loop"

## Type it yourself
- `automate volume at 0 0.2` · `automate volume at 4 1`
- `automate filter points 0:400 4:6000` several points at once
- `automate pan at 0 -1` · `automate delay-mix at 4 0`
- `automate distort-drive points 0:1 8:6`
- `automate filter remove 4` delete one point
- `clear filter automation` · `clear automation`

## Menu
- Ctrl-K › Mix › automation: each lane, add points, ramp, clear lane
