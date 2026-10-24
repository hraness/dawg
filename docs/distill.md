# Distilled styles: hyperpop

A large model writes and polishes demo songs by hand. The distill framework
turns what those demos do into a plan small enough for a local model, such as
Gemma 4 26B-A4B, to fill in. The local model writes the plan, and dawg's own
code does the production.

Hyperpop is the first style. The code is in `core/distill/hyperpop/`.

There are two ways to make a song. The default is the genome: a seed draws a
new song from a space of independent musical choices, and the model writes
only the words and the mood. The classic path (`--classic`) has the model
fill a sheet that the three demos' production plays. Classic songs come out
as near-copies of a demo, so it is kept for editing sheets by hand.

## Generated songs: the genome

The code is in `core/distill/hyperpop/genome/`. A song is a seed, and the
seed draws every axis independently, so the axes combine into songs no demo
contains:

- **Groove:** a drum grammar for the drops and one for the verses: four, break, jersey, trap, gabber, footwork, twostep, dembow, bounce or glitch. Fills, ghost notes, swing and tempo (about 90 to 190 BPM, with half-time feels) are drawn as well.
- **Harmony:** a tonic and a mode (major, minor, dorian, mixolydian, lydian, phrygian), and a chord language per section: a loop, a pedal under moving chords, borrowed chords (major and mixolydian only), a circle of fifths or a two-chord vamp. The harmonic rhythm is drawn too. One key for the whole song: nothing in the genome can change key.
- **Melody:** motifs grown from a rhythm cell and a contour, phrase plans (ABAB, AABA, AB, AA′ and so on), leap size and register.
- **Sounds:** a bass, lead, pad, stab and arp from the sound tables, plus brightness, grit and space.
- **Voice:** sung, chipmunk, robot, whisper, abstract, chopped or instrumental, and how much of the vocal is words.
- **Form:** classic, dropFirst, beatSwitch, slowBurn, falseEnding, through or miniature, with an energy shape.
- **Moves:** tape stops, dives, stutters, gaps, risers, crushes, downlifters, filters, glitches, octave jumps and half-time switches.
- **Counterpoint:** a countermelody in bridges and, in about one song in four, a fugue break. A short subject enters in two or three voices in turn (synth, vox or both), and the voices are settled beat by beat so they agree.

| File           | Role                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `genome.ts`    | `sampleGenome(seed, pins)` draws the axes; pins fix any of them. `describeGenome` says what was drawn in a few lines.                                                                                                                                                                                                                             |
| `compose.ts`   | `compileGenome(genome, content)` is the arranger. It lays out the form, writes each part by section, adds the seams before drops, shapes the dynamics so verses sit about 2 dB under the drops and builds swell into them, and keeps the score under 4,096 notes.                                                                                 |
| `card.ts`      | The song card the model writes: a title, theme, hook and verse lines, a mood, pins for only what the brief names, and the music. `validateCard` repairs what it can, and `musicNotes` names what the model can fix in another round. Without music, mood steers the mode, the drums and the sound design; with music, mood shapes only the sound. |
| `music.ts`     | The music on a card: chord loops as Roman numerals in the song's mode (drop, verse, pre, bridge), motifs as a 16th-note grid and scale steps (hook, verse, pre, bridge, switch), phrase plans and arranging habits. `readMusic` turns it into chords and motifs; numerals outside the mode are dropped, so the key never changes.                 |
| `generate.ts`  | `generateGenomeSong(brief, model, { seed })` draws the constraints for the brief and seed first (`briefConstraints`), shows them to the model, asks for a card, retries an unreadable card or fixable music, and composes it. `songFromCard(card, seed)` needs no model.                                                                          |
| `diversity.ts` | `fingerprint(score)` and `distance(a, b)` compare any two scores on tempo, kick and snare placement, pitch profile, melodic motion, layer density and form. `spread` reports the mean and closest pair.                                                                                                                                           |

### Who decides what

The seed decides the constraints: tempo, mode, beats, form, sounds, voice and
moves. That is where the variety comes from, so the same brief with a new seed
is a new song. The model decides the music inside them: the chords for each
section, the motifs every melody grows from, how phrases repeat, and what
carries the hook. That is where the taste comes from. The arranger performs
it: strong notes land on chord tones, the words are set one syllable per note,
a line every two bars, the echo opens on the word that ends a line, and the
singer stutters the hook's first word into the last drop. Anything the card
leaves out is drawn from the seed, so a card with no music still makes a song.

The prompt shows one worked card with the constraints it was written for,
rotating through three, so the model learns the shape without a template to
copy.

## The classic sheet

| File          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheet.ts`    | Defines the song sheet: key, bpm, palette, roman-numeral progressions (`V6` is a first inversion), sung lines as `[beat, degree, beats, syllable]` notes, lead hooks, and sections that name patterns, drums and layers. `validateSheet` rejects what it can't fix, such as an out-of-range bpm, an unknown key or a diminished chord. It repairs the rest and returns a warning for each repair, for example dropping a bad note or a dangling reference, or clamping a hook degree. A layer played with no pattern named gets the usual pattern for its section. On the candy palette every part lasts two bars, a note may start at beat -1 as a pickup, and each section kind has its one length. |
| `library.ts`  | Holds the named patterns the demos use for riffs, arps, bells, stabs and bass. The model picks patterns by name and never writes cells.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `compile.ts`  | Turns a sheet into a full score. The `night` and `glass` palettes go through the same hyperpop kit as Redline and Glass Garden (`core/demos/hyperpop.ts`), each with its demo's sound book, mix and vocal production: the vocoder, the backing harmonies, the drop chants, the glitch answers, throws and automation. A harmony guard moves a sung note that lands on a whole beat a semitone from a chord tone onto the chord, so no sheet can hold a minor-second rub. A short note that steps straight on to its neighbour is left alone, as an appoggiatura.                                                                                                                                      |
| `candy.ts`    | The candy palette: Candy Fault's arranging as rules. The sheet gives the chords, the sung lines and the hooks. The rules derive the rest from the chords: the Rhodes voicings, the pre-chorus stack and its 4-3 suspensions, the chorus stack and stabs, the 808, the chip arpeggios, the pluck's answers, the harmony and octave double, the glitch break's stuttered word, the silent beat and the tonic landing. Candy Fault's own instruments, mix and automation play them, placed on the new song's sections. It never changes key.                                                                                                                                                             |
| `extract.ts`  | Distills a demo back into a sheet. `DEMO_SOURCES` lists the demos that serve as examples: Redline (night), Glass Garden (glass) and Candy Fault (candy). Candy Fault has a build of its own, so `candySheet` writes its sheet from the demo's exported lines. It compiles back to within a few notes per track of the demo.                                                                                                                                                                                                                                                                                                                                                                           |
| `critic.ts`   | Scores a sheet out of 100 and returns fixes in plain words. It checks the palette's form. Night and glass need two drops, a drumless break, an intro and an outro. Candy needs three choruses, two pre-choruses, a break, a bridge and both hooks. It checks that on-beat notes don't clash a semitone with the chord, that each verse's lines don't all share one shape, that the lines don't all share one rhythm or one note length, that the melody avoids big leaps, that the chorus lifts above the verse, that chorus parts repeat, and that there is a lead hook. All three demos score 100.                                                                                                  |
| `prompt.ts`   | Holds the playbook: the technique written as rules a small model can follow, the pattern list, and the demo sheets as example turns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `schema.ts`   | The JSON schema llama.cpp uses to constrain the reply, so every reply parses.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `generate.ts` | `generateSong(brief, model)` runs the loop: brief, sheet, validate, settle, critique. Settling moves an on-beat note that clashes a semitone with its chord to the nearest chord tone, as the compiler would, so the retries go to rhythm and shape. It retries with the notes until a sheet scores 90 with at most 10% of its on-beat notes clashing (`maxRubs`), or the rounds run out, and keeps the best sheet. Each repair the validator made costs 2 points, so the retries fix those too.                                                                                                                                                                                                      |

## Using it

- `dawg make "an icy song about a phone dying at a party"` asks the local model for a song card and composes it from a random seed. `--seed N` picks the seed, so the same card and seed give the same song (the seed is mixed with the brief, so two briefs on one seed are two songs). `dawg make --seed N` with no brief composes with no model at all. `--wav out.wav` also renders it, and `--sheet s.json` keeps the card and seed.
- `dawg make --from s.json` composes a saved card with no model, or compiles a classic sheet.
- `dawg make --classic "<brief>"` writes a classic sheet instead. `--rounds 1-6` sets how many rounds to try.
- In the TUI the agent has `compose_song`, which takes a card and an optional seed and loads the song in one undoable edit. `song_guide` returns the card guide and the classic playbook, and with a brief and a seed the constraints that seed draws, and `write_song` loads a classic sheet. Any model can use these, local or remote.

## The local model

dawg looks for a GGUF in `~/.cache/dawg/models`, `~/.cache/sponge-llm` and `~/.lmstudio/models`. It prefers `gemma-4-26B-A4B-it-UD-Q4_K_M.gguf`, otherwise any Gemma 4. It needs `llama-server` (`brew install llama.cpp`). It starts the server on a free loopback port on the first request and stops it when dawg exits. When a model is found, `auto` provider selection uses it ahead of any key, and `dawg model key local` saves it as the choice.

- `DAWG_LOCAL_MODEL` and `DAWG_LLAMA_SERVER` point at a specific model file and server binary.
- `DAWG_LOCAL_BASE_URL` (with `DAWG_LOCAL_ALIAS`) uses a server that is already running.

One 26B model fits in 36 GB of memory, but two don't. If another app already has a model loaded, llama.cpp answers `Compute error.`, and dawg says so. On an M-series Mac with 36 GB of memory, Gemma 4 26B-A4B at Q4_K_M writes a sheet in about 45 s, at about 58 tokens/s.

## Evaluating

`bun scripts/genome-eval.ts [--n 12] [--seed 1] [--out DIR] [--model] ["brief" ...]` composes N seeds and prints each genome, the nearest demo and its distance, the pairwise spread and the closest pair. `--model` writes the cards with the local model first. The three demos sit about 0.44 apart from each other. Generated songs average about 0.4 apart and about 0.38 from the nearest demo. Classic sheets sit within 0.1 of their demo. The genome tests require every generated song to be more than 0.25 from every demo.

`bun scripts/distill-eval.ts [--out DIR] [--rounds N] ["brief" ...]` runs the briefs through the classic loop. For each one it prints every round's validity and critic score and writes `N.sheet.json` and `N.track.json`. Run either script with `--model` or the classic loop under the heavy compute lane, because they load a 17 GB model.

## Adding to the style, or a new style

To widen the genome, add a value to an axis (a drum grammar in `drums.ts`, a chord language in `theory.ts`, a sound in `sounds.ts`, a form or device in `genome.ts`) and give it a weight. The genome tests check that seeds still spread across every axis and stay far from the demos. To add a classic demo:

1. Write and polish a demo by hand with a large model, the way Redline and Glass Garden were made.
2. Export its book, sections and patterns from the demo file. Add any new patterns to `library.ts` under a name that describes their use.
3. Add the demo to `DEMO_SOURCES`. It then becomes an example sheet in every prompt. The distill tests check that it validates, scores at least 90 and renders.
4. If the demo has a sound of its own, add a palette in `compile.ts` and describe it in the playbook. A demo built outside the hyperpop engine, like Candy Fault, needs its rules written out as a palette of their own (`candy.ts`). It also needs a hand-written source in `DEMO_SOURCES`. Check that its sheet compiles back to the demo: the same note counts per track and the same loudness per section.
5. Rerun the eval and read the sheets it writes, not just the scores. When the small model keeps making the same mistake, either add a rule to the playbook and a check to the critic, or make the compiler enforce it.

A new style gets its own directory beside `hyperpop/` with the same pieces.
