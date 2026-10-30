# Authoring an original chart

The installed chart contract is [chart.schema.json](../chart.schema.json). Start
from [the small original example](../examples/original.chart.json), then write a
whole new song under the shared [house profile](house.md). The example demonstrates
grammar only; it is deliberately too short to be a finished house song.

A chart has `title`, tonic `key` (`C Db D Eb E F F# G Ab A Bb B`), `mode`, `bpm`,
`sounds` and ordered `sections`. New house songs use major and the profile tempo
range. `sounds` names pad, stab, arp, arp2, lead, counter, bass and singer choices,
three kit choices, and design values brightness/grit/space/width/echo in 0..1.
The example's palette is known to play; vary it through the installed sound tools
or valid chart palette rather than inventing unknown preset names.

Each section has `kind`, `name`, `bars` (one through eight), `chords`, `drums` and
`play`. Kinds: intro, verse, pre, chorus, drop, break, bridge, outro. One Roman
chord numeral per bar cycles across the section; `IV-V` splits a bar in half.
House major vocabulary is I, ii, iii, IV, V, vi and vii°, with compatible 7/maj7/add9
colors. Do not borrow chords or change key. Basic feels include four, break, jersey,
half, taps and none; reserve none/taps for a purposeful contrast rather than an
entire inactive song. Layers: pad, keys, stabs, arp, arp2, lead, counter, chops,
harmony, double, vocoder, cloud, spark, sub.

`sing`, `hook`, `counter` and `chops` contain lines. A line's `bar` starts from
zero inside the section. `rhythm` is a run of sixteenths: `x` starts a note,
`-` holds and `.` rests; spaces separate bars. Provide one scale degree in `notes`
per x. Degrees are 1..7; `'` raises an octave and `,` lowers one. A trailing `~`
adds vibrato, `>` a falling end. `words` supplies the corresponding sung syllables:
`pa- per` joins a word and `_` holds the previous vowel. A line may span up to four
bars. Keep held strong-beat notes on the current chord and avoid filling every gap.

Optional `energy` is 0..1; `drums2` changes the second half's feel. `stabs`, `kick`,
`snare` and `hats` contain cycling 16-step grids of digits for velocity and dots
for rests. `arp` cycles eight digits 0..4 over chord tones. Bass habits are lock,
hold, offbeat, rolling and walk. Useful moves include `{move:"riser"}`,
`{move:"silence"}`, `{move:"landing"}`, and
`{move:"dropout",bar:3,beat:3,beats:1,keep:["vox"]}`. Protect sung words from
destructive effects; use harsher transformations on fills and non-word chops.

Use `perform_chart` with `instrumental:true` to validate and hear a saved draft.
Then use `sing_chart` and default `perform_chart` with the same file/name/focused
track. The runtime validates musical syntax and reports problems rather than
treating this schema alone as evidence of a good or complete song.
