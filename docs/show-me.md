# Show-me: the agent works the way you would

When you ask the agent to do something, it does it with the commands a
person types, live, while its answer streams. You can learn dawg by
watching it work.

- **Ghost text.** The prompt bar shows the line the model is writing, token
  by token, at the model's own speed. There is no added typing delay.
- **Each line runs when it ends.** A complete line goes through the same
  `submit()` that Enter runs: the same parser, the same commit, the same
  undo step and the same sync to other windows. The score changes during
  the turn, not after it.
- **Caption.** One line under the prompt names the gesture, for example
  `typing tempo 96`, `fader · reverb mix → 0.4 · or type fx reverb mix 0.4`
  or `playing on keys: D (C4) · ctrl-p play mode · or type add C4 at 0`.
- **Finish hint.** At the end of the turn the caption says how to do it
  yourself, for example `do it yourself: type fx reverb mix 0.4 · or Ctrl-K
› Effects › Reverb`. All lines are in the Ctrl-O log as `agent › …`.
- **Nothing is replayed.** There is no queue after the turn and you never
  press a key to get the result. Typing, play mode and the next turn are
  never blocked.

`/showme on|quiet|off` (default `on`), the show-me row in Ctrl-K ›
Project › agent, and `showMe` in `config.json` choose how much is shown. `quiet`
keeps command mode and ghost text but drops captions, glides and note
sounds. `off` goes back to the JSON tool loop. Show-me needs a terminal.
Non-TTY runs, `dawg` subcommands, scripts and subscription providers
(Codex, Claude Code) use the JSON tool loop. Small terminals (80×24) and
`--no-mouse` are unaffected, since the ghost and caption use the prompt's
own rows.

## Why command lines, not JSON tools

The agent writes dawg prompt commands, one per line. A small JSON tool set
stays for what commands cannot express. We measured both on the same three
tasks (claude-haiku-4.5 through the gateway, empty score: reverb and pan, a
four-note arpeggio, a four-on-the-floor beat):

|                              | JSON tools               | command lines |
| ---------------------------- | ------------------------ | ------------- |
| input tokens per request     | ~26,980                  | ~2,910        |
| output tokens                | 89–212                   | 17–73         |
| first token                  | 0.65–0.74 s              | 0.46–0.53 s   |
| full turn                    | 1.15–1.97 s              | 0.71–1.11 s   |
| drum task complete in step 1 | no (made the track only) | yes           |

The prompt plus tool schemas fall from ~82 kB (11.4 kB prompt, 71.1 kB
for 72 tools) to ~22 kB (11.2 kB prompt with the command reference, 10.7
kB for the kept tools). What streams is literally what a person would
type, so no partial-JSON renderer is needed. A line that fails is fed back
once with the error, for a correction round (`COMMAND_MAX_STEPS` = 4).

## Gestures

| What the agent does                                                       | What you see and hear                                                                                       | Do it yourself                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| any command                                                               | ghost text, `typing …`                                                                                      | type the line, Enter                                                          |
| a parameter value (`volume`, `pan`, `fx <device> <param> <v>`, `synth …`) | the value glides ~150 ms in 30 ms steps through the staged audition path while the loop plays, then commits | the command, or the fader drawer: type the command without a value, or Ctrl-K |
| a note (`add C4 at 0`)                                                    | the play-mode key and octave keys in the caption; the note sounds on the audition voice in time             | Ctrl-P play mode, the named key                                               |
| a drum hit or row (`hit kick at 0`, `pattern hat 0 0.5`)                  | the drum key for that voice                                                                                 | Ctrl-P on a kit track                                                         |
| a groove, style or chords (`/pattern house`, `chords …`)                  | the typed command                                                                                           | the command, or Ctrl-K › Rhythm, or Ctrl-K › Chords and key                   |
| a track (`/track pad`, `/track rm pad`, `/track move pad 1`)              | the typed command                                                                                           | the command, or click the track name                                          |
| bars (`loop 5-6`, `copy bass 5-6 to 7`, `move bass 5-6 to 9`)             | the typed command; a TAPE pane draws the bars landing                                                       | the command, or Ctrl-T and the tape keys (`\`, `c`, `v`)                      |

Notes and timing: each streamed note is scheduled on the grid behind the
stream (`NoteScheduler`). If the model streams faster than the tempo, notes
keep their beat spacing. If slower, they sound as they land, like step
entry. Notes are never held back, and the score already has them.

## Exceptions, decided

| Case                                                                       | Decision                                                                                                                 | Why                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Long or bulk edits (a 64-bar style, 500 notes)                             | One command line (`/pattern`, `style`, `chords`) instead of note lines; notes past the stream's pace sound as step entry | Typing 500 `add` lines is slower than the human way. The command is what a person would use. |
| Fader glides                                                               | Only while the loop plays, ≤150 ms                                                                                       | Without audio nothing is heard, and a longer glide would delay the result                    |
| Menu paths                                                                 | Shown in the caption and finish hint, never as an animated cursor walk                                                   | A walk costs time and teaches less than the path                                             |
| Play-mode keys                                                             | Named in the caption; the on-screen keyboard is not pressed                                                              | Pressing play mode would switch your window's mode under you mid-typing                      |
| Workspace files (`song.ts`, `tracks/`)                                     | JSON tools `read_file`/`write_file`/`edit_file`; the activity log shows the file                                         | No prompt command edits source; the files are the manual path                                |
| Web search, fetch                                                          | JSON tools, shown as tool lines                                                                                          | No manual UI beyond asking the agent                                                         |
| Download, stems, analyze, transcribe, lyrics, wavetable from audio         | JSON media tools; the caption names `dawg media <verb>`                                                                  | These are the CLI's `dawg media` commands; no in-TUI surface                                 |
| `explain`, `measure_mix`, `preview_sound`                                  | JSON tools                                                                                                               | Read-only; `/try` and `master measure` are the human forms                                   |
| Window-only commands (`/model`, `model key`, `/quit`, `/showme`, `/theme`) | Never run by the agent                                                                                                   | They change the person's window, not the song                                                |
| `tape`, `knobs`, `mix`, `panes`, `pin`, `follow`, `audio`                  | Never run by the agent                                                                                                   | They change a pane or this machine's devices, not the song                                   |
| The clipboard (`copy` without `to`, `paste`)                               | Never used; the agent types `copy … to` and `move … to`                                                                  | One revision each, and the agent's surface stays equal to the person's                       |
| Subscription providers, `/showme off`, non-TTY                             | JSON tool loop                                                                                                           | No streaming text channel we can parse line by line, or nobody watching                      |

## Operations without a human surface

Every `ScoreOperation` now has a typed command:

| Op                                        | Command                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `addNote` `removeNote` `updateNote`       | `add`, `remove`, `move`/`length`/`velocity`     |
| `addTrack`                                | `/track <name>`                                 |
| `removeTrack`                             | `/track rm <name>` (new)                        |
| `moveTrack`                               | `/track move <name> <position>` (new)           |
| `clearTrack`                              | `clear`                                         |
| `updateTrack`                             | `instrument`, `volume`, `pan`, `fx`, `synth`, … |
| `setAutomation`                           | `automate`                                      |
| `setTempo` `setMeter` `setTime` `setBars` | `tempo`, `meter`, `bars`, `extend`              |
| `setKey` `setTuning`                      | `key`, `scale`, `tuning`                        |
| `setMaster`                               | `master`                                        |
| `setClips`                                | `/vocal import`, `/clip`                        |

Before this change `removeTrack` and `moveTrack` were reachable only from
the agent planner and the SDK. Left as is: media analysis results
(`analyze_audio`, `transcribe_lyrics`) have no in-TUI command and stay on
`dawg media`.

## Code

- `src/agent/command-agent.ts`: the command-mode turn (stream, split lines,
  run, feed failures back).
- `src/agent/show-me.ts`: pure parts: `CommandLines`, `isAgentCommand`,
  `gestureFor`, `menuPathFor`, `finishHint`, `glideValues`, `NoteScheduler`.
  Callers pass the time in, so tests use fake clocks.
- `src/main.ts`: `showMeCommandHost` runs each line through `submit()`.
- Tests: `src/agent/show-me.test.ts`, `src/agent/command-agent.test.ts`,
  `test/pty-showme.test.ts` (a gated fake SSE gateway; ghost text and the
  first command's effect are asserted before the stream ends, and the
  streamed lines commit the same composition as typing them).
