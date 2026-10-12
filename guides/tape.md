---
id: tape
title: TAPE
parent: arrange
order: 6
---

TAPE (Ctrl-T) shows every track across the bars, like a tape
machine's reels. Each key prints the command it runs, so the prompt
teaches the typed form. Esc goes back.

## Ask

- "loop the chorus and copy its drums to bar 17"

## Type it yourself

- `tape` · `loop chorus` · `copy drums 9-16 to 17` · `jump 5.3`

## Menu

- Ctrl-K › Arrange › sections · form

## Keys

- ↑↓ pick a knob: ● playhead ▲ loop ■ tempo ◆ volume · ←→ turn it
- `\` loops the section here · `[` `]` `{` `}` `<` `>` shape the loop
- `c` copy · `x` cut · `v` paste (`V` inserts) · Delete clear · `~`
- Tab / Shift-Tab next / previous track · Page Up / Down jump eight
- `,` / `.` previous / next scene · `-` / `=` zoom out / in

## Mouse

The bottom two rows keep track and scene navigation, zoom, copy, cut,
paste, loop, mix and sound controls visible. Click their labels to act;
click a scene name to jump there. The track counter opens the full,
searchable track list, including tracks beyond the first nine.

Track rows retain their numbers and show M (muted), S (solo), A
(automation) and F (effects); narrow terminals keep M/S. Click M to
toggle mute; click S on the focused row to toggle solo. Wheel over track
names to browse rows, or over the timeline to move through bars. The
focused track's full name and edit range stay in the range line.

## Next

- Form repeats are shaded `░`; an edit there says which copies it hits
- Tip: `dawg pane tape` keeps TAPE open in another terminal
- `guide arrange` · `guide panes`
