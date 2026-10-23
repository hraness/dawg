# Distilled styles: hyperpop

A large model writes and polishes demo songs by hand. The distill framework
turns what those demos do into a plan small enough for a local model, such as
Gemma 4 26B-A4B, to fill in. The local model writes the plan, and dawg's own
code does the production.

Hyperpop is the first style. The code is in `core/distill/hyperpop/`.

## The pieces

| File          | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheet.ts`    | Defines the song sheet: key, bpm, palette, roman-numeral progressions, sung lines as `[beat, degree, beats, syllable]` notes, lead hooks, and sections that name patterns, drums and layers. `validateSheet` rejects what it can't fix, such as an out-of-range bpm, an unknown key or a diminished chord. It repairs the rest and returns a warning for each repair, for example dropping a bad note or a dangling reference, or clamping a hook degree. A layer played with no pattern named gets the usual pattern for its section. |
| `library.ts`  | Holds the named patterns the demos use for riffs, arps, bells, stabs and bass. The model picks patterns by name and never writes cells.                                                                                                                                                                                                                                                                                                                                                                                                |
| `compile.ts`  | Turns a sheet into a full score through the same hyperpop kit as the demos (`core/demos/hyperpop.ts`). Each palette (`night`, `glass`) brings its demo's sound book, mix and vocal production: the vocoder, the backing harmonies, the drop chants, the glitch answers, throws and automation. A harmony guard moves a sung note that lands on a whole beat a semitone from a chord tone onto the chord, so no sheet can hold a minor-second rub.                                                                                      |
| `extract.ts`  | Distills a demo back into a sheet. `DEMO_SOURCES` lists the demos that serve as examples: Redline (night) and Glass Garden (glass).                                                                                                                                                                                                                                                                                                                                                                                                    |
| `critic.ts`   | Scores a sheet out of 100 and returns fixes in plain words. It checks the form: two drops, a drumless break, an intro and an outro. It checks that the drops are riff-led, that verses keep a texture, that on-beat notes don't clash a semitone with the chord, that verse lines don't all share one shape, that the melody avoids big leaps, that the chorus lifts above the verse, that chorus parts repeat, and that there is a lead hook. Both demos score 100.                                                                   |
| `prompt.ts`   | Holds the playbook: the technique written as rules a small model can follow, the pattern list, and the demo sheets as example turns.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `schema.ts`   | The JSON schema llama.cpp uses to constrain the reply, so every reply parses.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `generate.ts` | `generateSong(brief, model)` runs the loop: brief, sheet, validate, critique. Then it retries with the notes until a sheet scores 90 or the rounds run out, and keeps the best sheet. Each repair the validator made costs 2 points, so the retries fix those too.                                                                                                                                                                                                                                                                     |

## Using it

- `dawg make "an icy song about a phone dying at a party"` writes a sheet with the local model and compiles it to a `.track.json`. `--wav out.wav` also renders it, `--sheet s.json` keeps the sheet, and `--rounds 1-6` sets how many rounds to try.
- `dawg make --from s.json` compiles a sheet you edited, with no model.
- In the TUI the agent has `song_guide`, which returns the playbook and an example, and `write_song`, which validates, compiles and loads a sheet in one undoable edit. Any model can use these, local or remote.

## The local model

dawg looks for a GGUF in `~/.cache/dawg/models`, `~/.cache/sponge-llm` and `~/.lmstudio/models`. It prefers `gemma-4-26B-A4B-it-UD-Q4_K_M.gguf`, otherwise any Gemma 4. It needs `llama-server` (`brew install llama.cpp`). It starts the server on a free loopback port on the first request and stops it when dawg exits. When a model is found, `auto` provider selection uses it ahead of any key, and `dawg model key local` saves it as the choice.

- `DAWG_LOCAL_MODEL` and `DAWG_LLAMA_SERVER` point at a specific model file and server binary.
- `DAWG_LOCAL_BASE_URL` (with `DAWG_LOCAL_ALIAS`) uses a server that is already running.

One 26B model fits in 36 GB of memory, but two don't. If another app already has a model loaded, llama.cpp answers `Compute error.`, and dawg says so. On an M-series Mac with 36 GB of memory, Gemma 4 26B-A4B at Q4_K_M writes a sheet in about 45 s, at about 58 tokens/s.

## Evaluating

`bun scripts/distill-eval.ts [--out DIR] [--rounds N] ["brief" ...]` runs the briefs through the local model. For each one it prints every round's validity and critic score and writes `N.sheet.json` and `N.track.json`. Run it under the heavy compute lane, because it loads a 17 GB model.

## Adding to the style, or a new style

1. Write and polish a demo by hand with a large model, the way Redline and Glass Garden were made.
2. Export its book, sections and patterns from the demo file. Add any new patterns to `library.ts` under a name that describes their use.
3. Add the demo to `DEMO_SOURCES`. It then becomes an example sheet in every prompt. The distill tests check that it validates, scores at least 90 and renders.
4. If the demo has a sound of its own, add a palette in `compile.ts` and describe it in the playbook.
5. Rerun the eval and read the sheets it writes, not just the scores. When the small model keeps making the same mistake, either add a rule to the playbook and a check to the critic, or make the compiler enforce it.

A new style gets its own directory beside `hyperpop/` with the same pieces.
