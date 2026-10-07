# Changelog

All notable changes to dawg are recorded here. Versions follow [semantic versioning](https://semver.org); releases are published as immutable GitHub Releases with a tarball, `SHA256SUMS` and a build provenance attestation.

## Unreleased

### Rhythm (Euclidean rows)

- **Drum parts as generators.** A kit or oneshot sampler track can carry `rhythm` rows: `euclid("kick", 4, 16)`, `euclid("hat", 7, 16, 2, { swing: 0.15 })`, `grid("snare", "....X.......x...")`. dawg expands them into ordinary notes, so you and the agent edit four numbers instead of sixteen hits, and rendering, sync and diffs are unchanged. Patterns and rotation match Strudel's `euclid`/`euclidRot`.
- **Torso T-1 parameters**: steps, pulses, rotate, division, repeats with time/pace/ramp (rolls that speed up, slow down, build or fade), velocity, accent, gate/legato, seeded probability, swing, nudge and per-pass cycles. The same seed always gives the same hits.
- **`/euclid` editor** (also Rhythm in `/menu`): one row per voice with its step grid. Arrows nudge the selected parameter, Tab moves between parameters, digits type a value, Space auditions. Every change is one undo step.
- **Prompt grammar**: `euclid kick 4 16`, `euclid hat 7 16 rotate 2`, `euclid hat swing 0.2`, `euclid snare off|freeze`, `grid snare ....X.......x...`.
- The agent's new `set_rhythm` tool takes the same rows, and the agent prefers it to hand-placed drum hits.
- Editing a generated lane by hand freezes that row into plain notes. Changing the loop length regenerates rows.

### Fixed

- Gateway web searches no longer count the search fee twice in the spend line and ledger. The gateway's reported cost already includes it. A real Exa search response is now a test fixture.

## 0.3.0

dawg projects are now plain TypeScript files that you, an agent or another window can edit, with sampler tracks, local media tools, a computer-keyboard play mode and menus for every edit by hand.

### Play mode (computer keyboard)

- **`/play` or Ctrl-P** turns the computer keyboard into a MIDI keyboard for the focused track: `A S D F G H J K L ; '` are white keys from C, `W E T Y U O P` the black keys, `Z`/`X` move an octave, `C`/`V` change velocity, Shift sustains and Tab latches sustain. Esc leaves.
- Bass tracks start an octave lower and leads an octave higher; the header shows the range, velocity, record state, click and grid.
- **Recording.** `R` arms overdub and `Shift-R` replaces the bar; notes are quantized to `/grid` and land as ordinary score edits, so other windows, undo and `track.ts` all see them. One undo step per recorded bar.
- **Click track.** `M` or `/click on|off|<volume>` toggles a tempo-synced metronome that never reaches renders or exports; `/count-in 0|1|2` sets the count-in before recording.
- Sampler tracks play their voices from the keyboard: oneshot voices from MIDI 36, keyed samplers repitched from their root.
- Terminals send no key-up, so held notes last one grid step and extend while the key auto-repeats.

### Menus

- **`/menu [section]` or Ctrl-K** opens Track, Parameters, Effects, Automation, Mix and Transport. Arrows or `j k` move, Enter opens or toggles, `← →` or `+ -` nudge, digits type a value, `/` filters, `x` deletes an automation point, Esc steps back.
- Each row shows its current value and the command it runs; every change is one receipt and one undo step.
- New prompt commands behind the menu: `automate <lane> points <b:v>...`, `automate <lane> remove <beat>`, `track name <text>` and `meter <n>`.

### Performance

- Session records store reverse deltas instead of whole compositions, so a session reaches the 2000-event cap instead of failing around edit 70 (or on the first edit of a 16-bar loop).
- Audio renders run off the main thread with a per-track stem cache: a one-note edit re-renders in about 44 ms instead of blocking for 165–190 ms.
- AI Gateway and OpenRouter requests retry and time out when no response arrives; transport keys no longer wait on the daemon.

### Sample playback

- **Sampler tracks play.** `sampler({...})` voices now render in playback, `dawg render` and exports, with Strudel's semantics: `begin`/`end` windows, `speed` (negative reverses), `loop` for the note's length, `gain`, `choke` groups (Strudel's `cut`), keyed repitching from `root`, and oneshot voices on pitch slots from 36. Starts, stops and cuts fade over a few milliseconds. Volume, pan, automation, filter, delay and reverb apply as on any track, and sampler tracks are cached stems keyed by the files' sha256.
- **Decoding.** WAV (PCM 16/24/32-bit and float32) and AIFF decode natively and resample to the engine rate; MP3, FLAC, Ogg and M4A decode through `ffmpeg` when it is on `PATH`, otherwise the voice is skipped with a diagnostic. Decoded audio is cached at `.dawg/assets/<sha256>.pcm` (512 MiB LRU). Files over 50 MiB or 10 minutes and paths that escape the project, symlinks included, are rejected; a stale `sha256` warns and still plays.
- **`/sample <path> [as <voice>]`** adds a voice to the focused track (copying the file into `tracks/<slug>/samples/` and reprinting `track.ts`); `/sample` lists voices. Oneshot samplers get one highway lane per voice, `/tracks` shows sample counts and missing files, and load problems are receipts.
- `dawg render` in a project with no `--session` renders the project files (`song.ts`).

### Sign-in, model picker and spend

- **One sign-in picker.** `dawg login` (and the first `dawg` with no provider) finds what is already set up, in parallel within 4 s: `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, stored keys, a logged-in Vercel CLI, `VERCEL_OIDC_TOKEN`, and xcb Codex and Claude accounts. It then shows one Codex-style picker (arrows, numbers, Enter), with the first detected option as the default. When one option is ready, it asks `Use <it>? [Y/n]`. Non-interactive runs pick the best detected option or exit with a hint.
- **OpenRouter** is a fourth provider. Sign-in is OpenRouter's OAuth PKCE flow (browser plus a `127.0.0.1` callback with a state check, URL printed as a fallback, 5 min timeout), or a pasted key with hidden input. Turns stream with tool calls through the same agent tools as the gateway.
- **Subscriptions** (`dawg login codex`, `dawg login claude`) go through xcb 0.20+: pick the account and model, and dawg runs `xcb setup <family>` when none is ready. An account is usable iff xcb reports `available`. Pending admission works, with a longer first call (the child timeout is `timeoutMs + 75 s`) and `busy` retried with backoff. Accounts reporting `models_unavailable` are refreshed once, and `dawg auth status` prints the xcb version with an upgrade hint below 0.20.0.
- **The choice sticks.** The provider, model and account are saved in `~/.config/dawg/config.json` (0600, atomic, no keys) and reused silently. `dawg logout [provider]`/`/logout`, `dawg login <provider>` and `/model` change it. A saved provider that stops working is reported once and reopens the picker, never swapped.
- **`/login` in the TUI** suspends the screen, runs the same flow (browser and `vercel login` included) and redraws, replacing "run dawg login in a shell".
- **Model picker.** `/model` or `dawg model` lists frontier (Opus 5.5, Fable 5.1, GPT-6.1 Sol, Gemini 3.1 Pro), fast (Sonnet 5.5, Haiku 4.5, GPT-5.4 mini, Gemini 3.8 Flash) and open-weight models (DeepSeek V4 Pro, Kimi K3, Qwen3.8 27B, GLM-5.3, Llama 4 Maverick). Only tool-calling models the provider serves are listed. Each row shows an estimated `~$0.004/prompt` from models.dev pricing (cached 24 h; OpenRouter's own prices on OpenRouter), and subscriptions list xcb's models as `included`. Type to filter; the current model is marked. `DAWG_MODEL=<unknown>` is now an error listing the choices.
- **Spend under the prompt.** `$0.12 session · $0.48 today · opus-5.5 · gateway`, from the usage each response reports (`include_usage`; the provider's cost when given). Today's total is shared across windows through `~/.config/dawg/usage.json`. Billed web searches count too. Subscriptions show `subscription`; with no provider it reads `no model · dawg login`, the placeholder teaches direct commands and the STEER pill hides. The model shows once, in the header.
- `dawg auth status` lists all four options with detected, active and validated state.

### npm

`@hraness/dawg` is on npm: `npm i -g @hraness/dawg` or `bun add -g @hraness/dawg`, alongside the install script and the GitHub Release tarball.

### UX review fixes

- `/track <name>` (and bare `track <name>`) focuses the track in this window, creating it when new; a track another window has open answers `<name> is open in another window`. The quickstart `track drums` → `pattern kick …` now works.
- Receipts carry their outcome structurally, so `main is not a drum track`, `no kick hits`, `score is full` and friends render as errors instead of green checks.
- An unknown `/word` is rejected locally and a known verb with bad arguments (`pan 3`, `volume 2`, `add H4 at 0`, `/export` with no file) gets usage; neither reaches the model.
- `/help` (or `?`) opens a grouped, scrollable overlay listing every command once; `/sessions` and `/tracks` open the same overlay and leave one summary card.
- `dawg --version`; unknown subcommands and options are rejected before `.dawg/` is created; the launch that creates `.dawg/` says `created .dawg/ · add it to .gitignore`; `dawg --session <typo>` is an error instead of a silent new session; `render --help` and `sessions --help`.
- `/resume <n>` accepts any list index as well as a name or id prefix.
- Errors share one shape, `<what> · <why> · <next step>` (`no such file · nope.json`).
- The `^z undo` hint rides only on receipts that changed the score, and only the first three in a session.
- An empty track shows `main · empty · add C4 at 0 to start` instead of stray lane labels.
- `/status` says `shared via dawgd` or `saved locally · no daemon`; auto-names announce as `<name> (auto-named) · rename with /rename <name>`.
- Docs: header order frozen in a test and corrected, render is stereo, the `meta` frame is listed, one environment table.

### Agent workspace and web tools

The agent can now work with the project directory and the web. `list_files` and `read_file` cover the whole project except `.dawg/`; `write_file` and `edit_file` are limited to `song.ts` and the focused track's `tracks/<slug>/` directory, write atomically and cap sizes. `web_search` answers through the AI Gateway's server-side search tools when a gateway key is configured (`DAWG_WEB_SEARCH` picks `exa`, `perplexity`, `parallel` or `browserbase`), through OpenRouter's `web` plugin when an OpenRouter key exists, and otherwise through DuckDuckGo; `BRAVE_SEARCH_API_KEY` overrides the chain. `fetch_url` reads one public page with private-address blocking and bounded output. The composition brief includes a bounded project tree and the head of the focused track's `notes.md`. New `trackSlug()` in `core/slug.ts` and an optional `onWorkspaceWrite` host hook.

### Project files

- `dawg init [dir]` creates a project: `dawg.json`, `tsconfig.json`, `song.ts`, `tracks/`, a vendored typed SDK in `.dawg/sdk/v1.ts` and `.gitignore` lines. It is idempotent and refreshes the SDK only for a newer 1.x.
- Every window keeps `song.ts` and `tracks/<slug>/track.ts` in two-way sync with the session: file edits apply as one `files.apply` revision (`applied from files · …`, or `files rejected · <file:line:col …>`), and score edits reprint only the files that changed.
- `dawg check` typechecks (native TypeScript 7, incremental) and evaluates the project; the header shows `types ✓` or `types ✗ N`. Agent writes to project sources report the apply outcome and type errors in the tool result.
- Score: optional `sampler` on tracks (validated, rendered silent for now) and `removeTrack`, `moveTrack`, `setKey`, `setMeter` operations. The format stays `track.loop/v1`.
- `typescript` is now a runtime dependency; the package ships `core/sdk/**`.

### Local media tools

Six agent tools and `dawg media <verb>` turn reference audio into track material under `tracks/<slug>/downloads/`: `download_audio` (YouTube via yt-dlp or StemDeck, with a sidecar and reuse), `split_stems` (six stems via StemDeck or demucs), `analyze_audio` (tempo, key, beat grid, waveform), `transcribe_notes` (drums via a vendored classifier, pitched stems via basic-pitch, quantized to `note()`/`hit()` snippets), `import_sample` (48 kHz stereo `samples/<name>.wav` and a `sampler()` snippet) and `transcribe_lyrics` (whisper-cli). StemDeck at `DAWG_STEMDECK_URL` is preferred when it answers; dawg never installs a binary and `dawg media doctor` names the install commands. Helpers report progress on the activity card, are bounded in time and output, are stopped with SIGTERM then SIGKILL on Esc, and pause the turn deadline while they run.

## 0.2.0

The first tagged release. Open a session in several terminals, give each window its own instrument, let an agent write parts, and every window stays on the same song.

### Renamed from Track to dawg

The project, CLI and package are now **dawg**: the command is `dawg`, the daemon `dawgd`, the package `@hraness/dawg` and the repository [hraness/dawg](https://github.com/hraness/dawg) (the old `hraness/track` URLs redirect). Environment variables are `DAWG_*`, workspace state lives in `.dawg/`, config in `~/.config/dawg`, and gateway keys in the Keychain service `dawg` (new keys are named `dawg-<host>`).

### Install

```sh
curl -fsSL https://dawg.sh/install | sh
# or
bun add -g https://github.com/hraness/dawg/releases/download/v0.2.0/hraness-dawg-0.2.0.tgz
```

### Added

- **Stereo renderer.** Renders and `dawg render` WAVs are now interleaved stereo with equal-power pan, a ping-pong stereo delay and a stereo reverb, and stay byte-identical across runs.
- **Reverb send.** `reverb <mix> [size]` / `reverb off` per track, a deterministic Freeverb-style network (eight damped combs and four allpasses per channel). The agent's `set_effects` tool takes `reverb {mix, size}` or `null`.
- **More automation lanes.** `automate resonance|delay-feedback|delay-mix at <beat> <value>` (and `clear <lane> automation`), validated by the planner and available to the agent's `set_automation` tool.
- **Gapless audio engine.** Playback streams a seamless loop as raw PCM into one long-lived `ffplay` (or SoX `play`) process. Edits, tempo changes and seeks swap the buffer in place without restarting playback, and the write position stays anchored to the shared transport clock. On macOS without either, `afplay` replays a re-rendered loop. `dawg auth status` and `/auth` show the backend; `DAWG_AUDIO_BACKEND` and `DAWG_AUDIO_PLAYER` override it.
- **Drums and effects (#8).** A `kit` instrument with kick, rim, snare, clap, hats and tom, written with `hit <voice> at <beat>`, `pattern <voice> <beats...>` or `pattern <voice> every <step>`. A track named `drums` gets the kit automatically. Per-track low-pass filter (`filter <hz> [res]`), tempo-synced delay (`delay <beats> [fb] [mix]`), filter automation, `solo`/`unsolo` and `redo`.
- **Streaming agent (#9).** Requests that aren't direct commands go to a streaming, tool-calling agent on Vercel AI Gateway (`opus-5.5` or `sol-6.1`, switch with `/model`). It edits only through typed, validated tools, and each accepted call becomes its own revision. Esc cancels and keeps what was accepted. Enter steers the turn in progress.
- **dawgd (#10).** One local daemon per session, started by the first window. Every window sees the same revisions, presence and transport, so play in one window plays everywhere. It recovers from crashes, and if the daemon can't start, windows fall back to the file lock. `dawg sessions` lists the sessions in a workspace.
- **New terminal UI (#11).** A highway where notes stream toward a hit line, with sustain beams, hit bursts and drum lanes. It adds an activity strip of operation cards, a themed multiline prompt with steer and queue modes, and a transcript (`Ctrl+O` or `/log`). Themes are `/theme default|high-contrast|mono`. `/motion off` or `--reduce-motion` gives static states. `NO_COLOR` is respected.
- **Login and providers (#12).** `dawg login` creates an AI Gateway key with the Vercel CLI, or takes a pasted key. `dawg login --xcb` uses a Claude, Codex or Devin subscription through xcb. `dawg auth status` and `dawg logout` manage it. Keys are kept in the macOS Keychain or a 0600 file and never in `.dawg/`.
- **Named sessions (#13).** Sessions are named automatically from what you play, and you can rename them with `/rename <name>` (or hand the name back with `/rename --auto`). `/fork [name]` branches a song (`night drive` → `night drive 2`). `/sessions` lists them and `/resume` picks one. Plain `dawg` windows claim the next open track, so three windows on a three-track song restore drums, bass and keys, and a fourth gets a draft track.
- **`dawg render <out.wav>`** writes the current session (or `--session`, or `--import file.track.json`) to a WAV without starting audio. The same score always produces the same bytes, and the sha256 is printed.
- **`/status`** shows the session name, revision, composition digest and whether the window is on dawgd or the file fallback.
- An end-to-end suite that runs real `dawg` windows in PTYs against a live dawgd, now part of `bun run check` and CI.

### Fixed

- In demo mode, `--track drums` seeded the melodic demo notes, which played as rim hits. It now seeds a kick, snare and hat groove.

### Not yet

- dawg is not published to npm. Install from the GitHub Release tarball until a trusted publisher is configured.

## 0.1.0

Initial release (untagged): a local-first terminal piano roll with a shared `.track` session, direct note, tempo, instrument, volume and pan commands, volume and pan automation, undo, deterministic WAV playback through `afplay` or `ffplay`, and `track.loop/v1` import and export.
