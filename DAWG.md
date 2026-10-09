# dawg

dawg is a local-first terminal music workstation with a Pi-like agent loop. Each terminal window can focus on one track while a shared local session keeps the score, transport, and agent operations in sync. It is designed for `dawg` to feel like a coding agent session where the artifact is a loop you can hear and edit.

The first steel thread includes a typed `track.loop/v1` score, an append-only local session with a cross-window writer lock, a terminal piano-roll projection, a multiline prompt, a bounded streaming tool-calling agent on the Vercel AI Gateway, and a local PCM synthesizer. Provider and audio adapters remain behind explicit ports so the TUI can still be exercised without credentials or a sound device.

## Run

```sh
bun install
bun run dawg
```

Run `dawg` from any directory. It creates `.dawg/session` on first use and reuses that session in later terminal windows. Use `dawg --new` for a separate composition, `dawg --session <name|id>` to attach explicitly (an unknown value is `no session named "…" · dawg sessions`, never a new session), and `dawg --track bass` to focus a named track. `dawg --version` prints the version; unknown subcommands and options are rejected with usage before `.dawg/` exists, and the launch that creates `.dawg/` says `created .dawg/ · add it to .gitignore` in the strip. Every window connects to `dawgd`, a per-session daemon the first window starts in the background. It is the single writer: windows send operations with a base revision and an idempotency key, duplicate keys are no-ops, a stale full composition receives a typed rebase diagnostic, and a stale `operations` intent (what the agent sends) is replayed on the current score when nothing it touches changed since its base (the notes it updates or removes, the tracks it rewrites or clears, tempo and length, and ids it creates; at most 64 revisions back, with the base recovered by rewinding the event log); anything else still gets the rebase diagnostic. Every event stores a compact reverse delta (`rewind`) rather than a copy of the previous score, so a session record grows by about the size of each edit; when it nears its 4 MiB cap the oldest rewinds are compacted away and only that older history becomes unreachable. Rebased events record `rebasedFrom`, and their rewind leads back to the score they replayed on, so undo drops only that change, and on the file fallback the agent commits the full composition with the strict base check. Accepted commits are persisted through the same atomic snapshot store before being broadcast to every window. The daemon also owns the only transport and audio player, broadcasting play, pause, seek, and tempo with a timestamp so every window draws the same hit line. It keeps a presence table (`clientId`, `pid`, focused track) and can atomically claim the first unfocused track for a new window. The daemon exits 30 seconds after its last window closes, removes its socket on SIGTERM, and a crashed daemon's socket and lock are reclaimed by the next window. If `dawgd` cannot be started (or `DAWG_DAEMON=0`), windows fall back to the snapshot under the file lock, watching the session directory with `fs.watch` (so renames and edits from other windows arrive immediately) with a 1 s backstop poll, or a 200 ms poll where watching is unavailable, with presence kept in per-window heartbeat files. `dawg sessions` lists sessions in the current workspace. `dawg render <out.wav|out.mid> [--session <name|id>] [--import <file>]` reads the session record from disk (no daemon, no audio) and writes a stereo 16-bit WAV through the playback renderer (or a Standard MIDI File with tempo and time-signature meta events for `.mid`, see **Tempo and meter**); the same score always yields the same bytes, and the command prints the size and sha256. `/status` reports `status · <name> · rev <n> · <digest> · shared via dawgd` (or `saved locally · no daemon`), where the digest is the 16-hex composition digest dawgd broadcasts. In demo mode a drum track is seeded with a one-bar kick, snare and hat groove instead of melodic notes.

### Sessions, names and forks

Each session record carries bounded metadata alongside the score: `name` (1–40 printable characters), `nameSource` (`auto` or `user`), an optional `forkOf {sessionId, revision}`, the fingerprint the current auto-name was computed from, and a `version` counter. Records written before metadata existed load with an id-based auto name. Metadata writes are conditional (`expect {name?, nameSource?}`) and never touch the score revision or event log. Through `dawgd` they are a `meta` frame that the daemon applies, persists atomically and broadcasts; on the file fallback they run under the session lock, and polling windows pick up the newer `meta.version`. `/rename <name>` is unconditional and sets `nameSource=user`, so it wins over any auto-name computed against the old name, which arrives `stale` and is dropped. `/rename --auto` sets `nameSource=auto` and clears the stored fingerprint.

`/fork [name]` writes a new session with a snapshot of the composition at the current revision (not the event log), `forkOf` lineage and a numbered name: strip a trailing ` N` (N ≥ 2) from the parent, then take one more than the highest ` N` among sessions with that base. An explicit name that collides is suffixed the same way. The workspace pointer moves to the fork, so plain `dawg` resumes it. Undo does not stop at the fork point: the fork's history is its own events preceded by each ancestor's events up to the revision it was forked at, following `forkOf` at most 8 levels (stopping at cycles, missing parents or revisions beyond the parent's log) and keeping at most the store's event cap.

On launch, and after `/fork` or `/resume`, a window without `--track` sends an atomic `claim {draft: true}`. dawgd serializes claims on its event loop; the file fallback serializes them under the presence lock. The reply is the first track in score order that no live window has focused, or, when every track is taken, a fresh `track-N` id that is neither in the score nor focused by another window. A draft is only appended to the score (`track.attach`) on the window's first edit. `--session <name|id>` resolves an exact id, then an exact case-insensitive name, then a unique id prefix of at least four characters; ambiguous names list the candidates and exit.

The header shows the session name and, when more than one window is open, the window count. Renames, forks, claims and the all-tracks-open hint appear as activity cards. The session port exposes a structured sync status (`synced`, `syncing`, `conflict`, `offline`, `local`) that drives the header directly.

Auto-naming (`src/session/naming.ts`) is gated on a local musical fingerprint: tempo, a scale-fit key estimate from the pitch-class histogram (tonic and fifth weighted), sorted instrument families, register and density buckets, and effects, hashed into an order- and id-independent digest. After an accepted turn the namer waits for a quiet period, and skips the model when the fingerprint equals the one the current name came from or when fewer than three turns have passed since the last name (a structure change, such as a new instrument family, bypasses the turn gate). The prompt is one fingerprint line, the last two prompts truncated to 60 characters each, and the current name, with `max_tokens: 12`. The reply is untrusted: it is stripped to 2–4 lowercase words of at most 32 characters, and a reply equal to the current name keeps it (hysteresis). The write is conditional on the name and `nameSource` the request started from, and a newer request supersedes an older one, so a slow provider (xcb takes about 7 s) can never overwrite a user rename. Forks keep their ` N` suffix through auto-renames, and a name already used by another session is suffixed. The generator is an injectable `NameGenerator`; the default calls `generateText` from `src/agent/provider.ts` and falls back to the deterministic local name.

The `dawgd` protocol is newline-delimited JSON over a Unix socket in the session directory, or a hashed path under `$TMPDIR` when that path would exceed the platform socket-path limit. Every frame carries `v: 1`, frames are size-bounded, and every inbound frame is parsed from `unknown`. Clients send `hello`, `apply`, `transport`, `sync`, `focus`, `claim`, `meta`, and `ping`; the daemon replies with `welcome`, `result`, `snapshot`, `claimed`, `pong`, and typed `error` frames, and pushes `commit`, `transport`, `presence`, and `meta`.

The header (`dawg` · track · ▶/⏸ BPM · key · session · N windows, then model · rev · sync on the right; `test/tui.test.ts` freezes the order) sits above the highway. The highway sits above the activity strip and the prompt. Notes stream toward the hit line, and velocity sets glyph density (`░▒▓█`) and saturation. Beat and bar rules get stronger at each level. Sustains draw as beams with a decaying tail and a short ghost after release. Each hit runs approach glow → flash/burst at the line → fade. The hit line pulses on the beat, and a sweep marks the loop wrap. A track with no hits draws `<track> · empty · type a request · ctrl-p play · ctrl-k menu` (when narrower: `<track> · empty · add C4 at 0 to start`, or `hit kick at 0` on a kit) in place of bar numbers and lane labels; the hit line stays. Drum tracks use one lane per voice with a legend; lane projection is pluggable (`LaneProjection` in `tui/highway.ts`). By default every unmuted track is overlaid through its own projection and accent, the focused track drawn on top at full strength and the others dimmed; `/view focus` restores the single-track view. Animation is derived from transport time, so frame rate never changes timing. Frames render into a retained cell buffer, only changed rows are written, and output is capped at about 30 fps.

Keys: `Space` (empty prompt) toggles playback. `Enter` submits, or queues in QUEUE mode. `Shift+Enter`/`Ctrl+J` inserts a newline, `Alt+Enter` queues and `Ctrl+Q` toggles STEER/QUEUE. `Ctrl+Z`/`Ctrl+Y` undo and redo, and `Ctrl+O` or `/transcript` opens the transcript, which scrolls with ↑/↓, PgUp/PgDn and Home/End, and `/` cycles its filter (all, requests, ops, errors). `Esc` cancels an agent turn, closes the overlay or clears the draft. `Ctrl+L` redraws and `Ctrl+C` exits. Bracketed paste keeps multiline text intact.

Themes: `/theme default|high-contrast|mono`, `--theme`, `DAWG_THEME`. Color falls back through truecolor, 256-color, 16-color and monochrome. `NO_COLOR` and `TERM=dumb` are supported. `/motion off`, `--reduce-motion` and `DAWG_REDUCE_MOTION=1` switch to static states in the same positions. `--no-mouse` or `DAWG_MOUSE=0` keeps the terminal's own mouse selection (see **Mouse**).

Other code reports into the activity strip through `ActivityFeed` (`tui/activity.ts`): `pushCard(text, {tone, baseRevision, resultRevision, hint})`, `pushError(text)`, `setSpinner(label | undefined)`, `setQueueDepth(n)` and `applyAgentEvent(event)`, which accepts the agent's streaming `AgentEvent`s unchanged. Command handlers return a `Receipt` (`{ok: true | false | "warn", text}`), so a failure such as `main is not a drum track` is red because it says so, not because of its wording; `receiptTone` only classifies the legacy strings that remain. The `^z undo` hint rides only on receipts that changed the score, and only the first three in a session. `/help`, `/sessions` and `/tracks` open a scrollable text overlay (`TuiApp.openText`) and leave one summary card in the strip; `/help` is generated from `src/commands/help.ts`, which also feeds `dawg --help` and the usage hints that answer an unknown `/word` or a near-miss such as `pan 3` without a model call. A known verb followed by a sentence (three or more words, no numbers: `add a walking bass in A minor`) goes to the agent instead. An unknown `/word` names the nearest command (`unknown command /clik · did you mean /click? · /help`); a bare word one edit from a command whose remaining words parse as its arguments is suggested locally (`tempoo 90 · did you mean tempo 90?`); other bare words are requests for the agent.

`/help` opens a short, task-first guide: **start here** (type a request, Ctrl-P, Ctrl-K, `?`, undo), **play notes**, **make drums**, **shape the sound**, **chords**, **song structure**, and **more**. `/help all` is the full reference; `/help music`, `/help session`, `/help window` and `/help keys` show one group, and `/help arrange` lists every arranging command (`section`, `form`, `build`, `drop`, `fill`) with its full usage.

`/guide` (or F1) opens the user guides: one short page per feature (`guides/*.md`, shipped in the package and rendered unchanged on dawg.sh/docs), each showing what to ask the agent and the command, key or menu path that does the same by hand. The pane is a tree: ↑↓ (j k) move, → l or Enter expand a section then open a guide, ← h collapse or go to the parent and back from a page, `/` filters by title and text, Esc clears the filter, then steps back, then closes. `/guide chords` opens one guide directly. `guides/guides.test.ts` keeps every guide within 20 rows at 80 columns and checks every `/command` a guide names against the help reference.

The local command path understands requests such as:

```text
add C4 at 0 for 1
play
pause
tempo 128
instrument piano
volume 0.7
pan -0.4
automate volume at 0 0.2
automate volume at 4 1
automate pan at 0 -1
automate pan at 4 1
clear pan automation
/track drums
instrument kit
hit kick at 0
hit snare at 1 vel 0.7
pattern kick 0 1 2 3
pattern hat every 0.5 from 0.25
clear hat
filter 1200
filter 800 0.6
filter off
delay 0.375 0.3
delay 0.75 0.4 0.5
delay off
reverb 0.3
reverb 0.4 0.8
reverb off
automate filter at 0 400
automate filter at 4 6000
automate resonance at 0 0.2
automate delay-feedback at 0 0.6
automate delay-mix at 4 0
clear filter automation
bars 8
extend 4 bars
clear automation
mute
solo
unsolo
clear
undo
redo
move note <id> to 2.5
duration note <id> 0.25
/tracks
/status
/export loop.track.json
/import loop.track.json
/model opus-5.5
/help
/help all
```

`/track <name>` focuses a track in this window and creates it when it is new; when another live window has it focused the reply is `<name> is open in another window` and focus stays put. Music words are bare and app commands take a slash; `tracks`, `export`, `import` and `track` still work bare as aliases but are listed once.

Drum tracks use the `kit` instrument (a track named `drums` gets it automatically). Notes on a kit track keep the score's MIDI pitch field, using General MIDI percussion numbers (kick 36, rim 37, snare 38, clap 39, closed hat 42, tom 45, open hat 46), so drum hits round-trip through `track.loop/v1` unchanged and the highway draws them in one lane per voice. Grammar, one command per prompt, beats in score beats:

```text
hit <voice> [at] <beat> [vel <0..1>]
pattern <voice> <beat> [<beat> ...] [vel <0..1>]        up to 64 beats
pattern <voice> every <step> [from <beat>] [vel <0..1>]  step >= 0.125, fills the loop, at most 256 hits
clear <voice>
filter <cutoff 20..20000> [<resonance 0..1>] | filter off
delay <beats 0.0625..4> [<feedback 0..0.9> [<mix 0..1>]] | delay off
reverb <mix 0..1> [<size 0..1>] | reverb off     size defaults to 0.5
automate filter at <beat> <cutoff> | clear filter automation
automate resonance at <beat> <0..1> | clear resonance automation
automate delay-feedback at <beat> <0..0.9> | clear delay-feedback automation
automate delay-mix at <beat> <0..1> | clear delay-mix automation
automate <lane> points <beat:value> [<beat:value> ...]   merge points into a lane
automate <lane> remove <beat>                            drop one point
track name <text>                                       rename the focused track
meter <beats per bar 1..16>
tempo 90 at bar 9 ramp | rit 4 bars to 80 | fermata at 31 2 | meter 7/8 at bar 5
track rate 3/2 | track phasing 4 | track phasing 3 hold 8 | track time off
solo | unsolo
undo | redo
```

Effects live on the track as optional `filter {cutoff, resonance}`, `delay {beats, feedback, mix}`, `reverb {mix, size}`, `filterAutomation`, `resonanceAutomation`, `delayFeedbackAutomation`, `delayMixAutomation`, and `solo` fields. Effect lanes modulate an existing effect: a resonance lane needs a filter and the delay lanes need a delay. Documents written before these fields existed still parse; out-of-range or non-finite values are rejected. Undo and redo append ordinary session events, so history is shared by every window and a new edit clears the redo stack.

Unrecognized prompts go to the agent whenever a provider is configured (`DAWG_AI=0` disables it); see **Providers and auth** below. `src/agent/models.ts` holds the model catalog: frontier (`opus-5.5`, `fable-5.1`, `sol-6.1`, `gemini-3.1-pro`), fast (`sonnet-5.5`, `haiku-4.5`, `gpt-5.4-mini`, `gemini-3.8-flash`) and open weights (`deepseek-v4-pro`, `kimi-k3`, `qwen3.8-27b`, `glm-5.3`, `llama-4-maverick`), each with its gateway and OpenRouter ID, checked against the live gateway and OpenRouter model lists and tagged for tool use. The `/model` picker joins the catalog with the live list and shows only tool-calling models; any other `vendor/model` ID the provider lists is accepted too. `DAWG_MODEL` picks the model for one run, and an unknown value fails at startup with the valid list. The default is `opus-5.5`. `DAWG_OPUS_MODEL` / `DAWG_SOL_MODEL` still remap those two aliases.

### Agent turns

A turn calls `POST /v1/chat/completions` with `stream: true` and one JSON-schema tool for each operation family. The OpenAI-compatible SSE stream is parsed locally with `fetch`, so the agent adds no runtime dependency. Each request sends a compact, deterministic **composition brief** instead of raw logs. It contains revision, tempo, meter, bars, key, tracks with instrument, mix, note count and pitch range, the focused track's notes, recent accepted operations and the instrument list. It is capped at 12 KiB and never includes environment values.

When a tool call finishes streaming, it passes three checks: the tool's own argument checks, the planner's bounded operation validator, and a dry run of the score reducer. Only then is it committed through the session as a separate revision pinned to the revision it was planned against. If the call fails a check, or another window committed first (stale revision), dawg rejects it without changing the score. The model receives the diagnostic as the tool result and can correct itself. A turn is bounded to 8 steps, 32 tool calls, 256 KiB of streamed response and a 90 s timeout.

`runAgentTurn` (`src/agent/agent.ts`) emits structured progress events for the TUI: `step`, `text-delta`, `tool-start`, `tool-applied` (with `summary`, `baseRevision`, `resultRevision` and `trackId`), `tool-rejected` (with `diagnostic`), and a final `done` or `error` (`aborted`, `timeout`, `budget`, `provider`). To add an operation family, append a tool to `AGENT_TOOLS` in `src/agent/tools.ts`. The schema, dispatch and validation all come from that one entry.

### Workspace and web tools

The project directory (the directory `dawg` runs in) is the agent's workspace. Six more entries in `AGENT_TOOLS` give the model bounded file and web access on both the gateway and xcb paths; `src/agent/workspace.ts` holds the path policy and `src/web/` the network side.

- `list_files`, `read_file`: anywhere in the project except `.dawg/`, which dawg owns. Listings stop at 500 entries, reads at 256 KiB per call (1-based `offset` and `limit` page through larger files), and binary files (WAV, AIFF, FLAC, MP3, MIDI, images, archives) report type and size instead of bytes.
- `write_file`, `edit_file`: only `song.ts` and the focused track's `tracks/<slug>/` directory (`core/slug.ts` derives the slug from the track name). Writes are atomic (temp file and rename), capped at 1 MiB, and create parent directories. `edit_file` replaces exactly one occurrence of `old`; zero or several matches return a count and nothing changes. `tracks/<slug>/notes.md` is the model's scratchpad and is never parsed. After a write, the optional host hook `onWorkspaceWrite(path)` can append text to the tool result (the project lane uses it to report how `track.ts` applied).
- Every path is resolved lexically and then through `realpath`; `..`, absolute paths outside the root, symlinks that leave the project and anything under `.dawg/` are rejected with a diagnostic naming the writable roots. The brief gains a `project` entry with a tree of at most 30 lines and the first 1 KiB of the focused `notes.md`; both are shed before track summaries when the 12 KiB budget is tight.
- `web_search` returns up to 8 `{title, url, snippet}` results. Providers, first match wins: `BRAVE_SEARCH_API_KEY` (explicit override); an AI Gateway key, which makes one non-streaming `anthropic/claude-haiku-4.5` call with the gateway's server-side search tool (`DAWG_WEB_SEARCH=exa|perplexity|parallel|browserbase`, default `exa`; the gateway bills the search, about $0.007 for Exa; its reported cost already includes that fee, so dawg records it as-is and uses the fee as an estimate only when no cost is reported; a live Exa search with three results cost $0.013); an OpenRouter key (`OPENROUTER_API_KEY`), which uses the `web` plugin and its `url_citation` annotations; else DuckDuckGo's HTML endpoint. `DAWG_WEB_SEARCH` can also pin a backend (`duckduckgo`, `openrouter`, `gateway`, `brave`) when its credentials exist. A failing paid provider falls through to DuckDuckGo and the result says so. The activity card names the answering provider (`searched via gateway · exa`), and `WebHost.onSpend` reports each billed search for the spend ledger.
- `fetch_url` fetches one public http(s) URL locally: hostnames are resolved first and loopback, private, link-local, CGNAT and multicast addresses (IPv4, IPv6 and mapped) are refused, redirects (at most 3) are re-checked per hop, bodies stop at 2 MiB and the text handed to the model at 32 KiB. HTML is reduced to headings, lists, links and paragraphs; scripts, styles and navigation are dropped. Fetched text is untrusted and the system prompt says so.

All limits live in `WORKSPACE_LIMITS`, `SEARCH_LIMITS` and `FETCH_LIMITS`. Search and fetch take an injectable `fetch` (and `lookup`), so tests run on fixtures in `src/web/fixtures/` without network. The gateway search fixture is derived from the documented response shape; capture a live response once to confirm it.

### Media tools

Seven more `AGENT_TOOLS` entries (`src/media/`) turn reference audio into material for a track. They work on files under the focused track's `tracks/<slug>/downloads/` (the same slug and write scope as `write_file`), return project-relative output paths so the model can chain them, and never install anything: a missing binary is reported with its install command. `dawg media <verb>` runs the same code from the shell, and `dawg media doctor` lists the backend, each binary, how it runs and how to install it.

- `download_audio {url, name?}`: YouTube only (`youtube.com`, `youtu.be`, `music.youtube.com`). Writes `<name>.wav` plus a `<name>.json` sidecar (title, duration, source URL, backend, sha256, time). The same source URL is reused instead of downloaded again. yt-dlp runs with `--no-playlist`, `--max-filesize 500m` and a 15 min budget.
- `split_stems {file}`: six stems (vocals, drums, bass, guitar, piano, other) into `<base>.stems/`, cached once present. 20 min budget.
- `analyze_audio {file}`: ffprobe metadata, then tempo, key, a beat grid and 240 waveform peaks computed in TypeScript, written to `<base>.analysis.json`; the model sees 48 peaks.
- `transcribe_notes {file, kind?, from?, to?}`: drums use a vendored onset classifier mapped to dawg kit voices (kick, snare, clap, tom, hat, openhat, rim); pitched stems run `basic-pitch`. Notes are quantized onto the analysis beat grid (run first when missing) and returned as a `note()`/`hit()` snippet plus `<base>.<kind>.notes.json`, at most 2048 notes.
- `import_sample {file, name, begin?, end?, root?}`: ffmpeg converts the file (or a trimmed window) to 48 kHz stereo PCM16 at `tracks/<slug>/samples/<name>.wav` and returns its sha256, duration and a `sampler({ name: "samples/<name>.wav" })` snippet (`{src, root, begin, end}` when given; `begin`/`end` are fractions of the file, `root` defaults to C4; a root adds `{ mode: "keyed" }`).
- `make_wavetable {file, name, frames?, start?, end?, method?, smooth?, normalize?}`: reads the file (WAV directly, anything else through ffmpeg as 48 kHz mono, at most 10 minutes) and writes a float32 wavetable of `frames` (default 64, at most 256) 2048-sample frames with a `clm ` chunk to `tracks/<slug>/wavetables/<name>.wav`. See [Wavetables from audio](#wavetables-from-audio).
- `transcribe_lyrics {file, lang?}`: whisper-cli on a 16 kHz mono copy, writing `<base>.lyrics.json` (segments with seconds) and `.lyrics.txt`. The `ggml-base.en.bin` model (about 141 MiB) is announced and then downloaded once into `~/.cache/dawg/whisper/`.

**Backends.** When StemDeck answers `GET /api/health` at `DAWG_STEMDECK_URL` (default `http://127.0.0.1:8000`, no credentials or query allowed in the URL), downloads and stems go through its job API and the job id is kept in the sidecar so `analyze_audio` reuses StemDeck's beat grid. Otherwise dawg runs the binaries directly: `yt-dlp`, `ffmpeg`, `ffprobe`, `whisper-cli` (`brew install yt-dlp ffmpeg whisper-cpp`), and `demucs`/`basic-pitch` through `uv tool run` when `uv tool list` shows them (`uv tool install demucs`, `uv tool install basic-pitch`). demucs downloads its model on first run.

**Bounds.** Every subprocess goes through the injectable `CommandRunner` with a per-tool timeout, 1 MiB of captured output, and SIGTERM then SIGKILL on Esc or abort. Helper output becomes throttled one-line progress (`demucs 42%`, `stemdeck separating 42%`) on the activity card through the `tool-progress` event. The turn deadline is paused while a media helper runs, so a 10 minute separation does not time out the turn; the other turn budgets still apply. WAVs read into memory are capped at 256 MiB. Input paths must stay inside the project. URLs are never logged with credentials. The drum classifier, beat-grid fitting, WAV codec and basic-pitch CSV parser are vendored from soundfish in `src/media/vendor/` with a header crediting it; tests stub every binary and StemDeck with `scriptedRunner`, fetch fixtures and a drum excerpt in `src/media/fixtures/`. `DAWG_LIVE_MEDIA=1 bun test src/media` adds one live ffprobe smoke test.

### Providers and auth

`src/agent/provider.ts` picks a backend per turn: `DAWG_PROVIDER`, then the choice saved in `~/.config/dawg/config.json`, then `auto` (AI Gateway, then OpenRouter, then a ready Codex or Claude subscription, else offline with a `dawg login` hint). The config holds `provider`, the model and, for subscriptions, the xcb account. It is written atomically with 0600 permissions and never holds a key. A saved choice that stops working (revoked key, account gone) comes back as `offline` with `invalidSaved` and the reason; startup and `dawg login` say so once and open the picker rather than switching providers. Only `dawg logout`, `/logout`, `dawg login <provider>` and `/model` change it.

Keys (`ai-gateway`, `openrouter`) resolve from the environment (`AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`), then the macOS Keychain (service `dawg`), then `~/.config/dawg/credentials.json` (0600 under a 0700 directory, written atomically through a temp file and rename). Storing uses `security -i` with the command on stdin, so a key never appears on an argv. Keys must match `[A-Za-z0-9._-]{16,256}` and are shown only masked (`vck_…abcd`). Nothing auth-related goes to `.dawg/`.

`src/auth/discover.ts` probes all four options in parallel, each with a 4 s cap and no network beyond the local CLIs: environment and stored keys, `vercel whoami --format json --non-interactive`, `VERCEL_OIDC_TOKEN` (a usable gateway credential in a linked project), and `xcb --version` plus `xcb --json generate --capabilities` split by provider family. xcb accounts are usable iff `available === true`; `admission` (`pending | admitted | qualified | null`) is informational, and pending accounts are usable with a slower first call. Accounts reporting `models_unavailable` are refreshed once per process (`xcb accounts refresh <id>`, in parallel, 10 s each) and re-read. Reasons map to one-line hints (`application_disabled` → `xcb application enable`, `admission_failed` → retry after 15 minutes); xcb older than 0.20.0 is reported with an upgrade hint.

`src/auth/login.ts` turns the probes into one picker (`src/auth/picker.ts`, a pure model the shell and TUI both render: arrows, numbers, Enter, type-to-filter). Per option:

- **Gateway**: with the Vercel CLI, `vercel login` gets the terminal when needed, then `vercel ai-gateway api-keys create --name dawg-<host> --non-interactive [--limit <dollars>]` prints only the key on stdout. Without it, dawg opens the gateway keys page and reads a pasted key with echo off. Validation is `GET /v1/credits`.
- **OpenRouter** (`src/auth/openrouter.ts`): OAuth PKCE. A server on `127.0.0.1:<ephemeral>` waits for `/callback` and checks a random `state`. The browser opens `https://openrouter.ai/auth?callback_url=…&code_challenge=<S256>&code_challenge_method=S256`, and the code goes to `POST /api/v1/auth/keys` with the verifier. The URL is printed for headless use, the server closes after 5 minutes, and validation is `GET /api/v1/key`.
- **Codex / Claude**: lists usable xcb accounts of that family and the models xcb reports for them (only models with an admission state). With none ready, dawg runs `xcb setup <family>` with the terminal; otherwise it prints the command.

Every subprocess goes through the injectable `CommandRunner` in `src/auth/runner.ts`, which bounds output, writes stdin and on abort sends SIGTERM (SIGKILL after 15 s) and waits for exit. Tests script `vercel`, `security` and `xcb` through it and run OpenRouter against a local fake server.

`/login` in the TUI calls `handoff()`: it stops the frame timer, detaches stdin, leaves raw mode, bracketed paste and the alternate screen, runs the same flow on the real terminal, then re-enters, clears and forces a full redraw.

The gateway and OpenRouter share `src/agent/gateway.ts`, an OpenAI-compatible streaming client with tool calls that requests `stream_options.include_usage`. `src/agent/usage.ts` prices each usage chunk, using the provider's own `cost` when present and otherwise tokens × the models.dev price. It keeps the session total and a daily ledger in `~/.config/dawg/usage.json` (31 days, lock file plus atomic rename) that windows share, and draws the spend line under the prompt (`$0.12 session · $0.48 today · opus-5.5 · gateway`; `subscription` for xcb; `no model · dawg login` offline; it narrows by dropping today, then session). Billed web searches add to the same meter. Prices come from `https://models.dev/api.json`, cached in `~/.config/dawg/cache/` for 24 h, fetched with a timeout and size cap, with a stale cache preferred to nothing offline; on OpenRouter its own `/models` prices win. The picker's `~$0.005/prompt` is `TYPICAL_PROMPT` (≈ 22,100 input + 600 output tokens, measured from the system prompt, tool schemas and a fixture brief over about 2 requests) × price.

The xcb provider (`src/agent/xcb.ts`, `src/agent/xcb-agent.ts`) calls `xcb --json generate` with one `{version:1, account, model, prompt, timeoutMs, maxOutputBytes}` request on stdin. xcb exposes zero tools and does not stream, so the prompt carries the system rules, the composition brief and the tool catalog as JSON schemas, and asks for exactly one `{ops:[{tool,args}], say?, done}` object. The reply is untrusted. dawg takes the first balanced JSON object in at most 64 KiB, allows at most 16 ops and caps `say` at 400 characters. Each op then goes through `executeCall`, the same argument checks, operation validator, reducer dry run and per-op revision commit used by the gateway loop, and emits the same `tool-applied`/`tool-rejected`/`text-delta` events. If a reply cannot be parsed, an op is rejected or `done` is false, dawg makes another call with the per-op results, up to 3 calls and within the normal turn budgets. Esc aborts the turn, which terminates the xcb child and keeps every accepted revision. The child timeout is `timeoutMs + 75 s`, because the first `generate` per binding (and after an xcb or provider update) admits the account and can take up to a minute longer. A `busy` result, when two first calls hit one account, is retried with backoff. Accounts come from `xcb --json generate --capabilities`, parsed field by field from `unknown`. dawg never runs the xcb installer.

`generateText(prompt, {maxTokens, signal?, timeoutMs?, selection?})` from `src/agent/provider.ts` is a tool-free one-shot completion for helpers like session naming. On the gateway and OpenRouter it uses `anthropic/claude-haiku-4.5` with `max_tokens`. On xcb it uses the selected account with `maxOutputBytes ≈ 8 × maxTokens`. It returns at most 512 trimmed characters of untrusted text and throws when offline, so callers should fall back to a local default.

Playback renders the score to interleaved stereo 16-bit PCM with deterministic sine, piano, pluck, bass, saw, square, and triangle voices and a synthesized kit whose noise comes from a PRNG seeded by each note, so every render is byte-identical. Track volume and pan automation, the low-pass filter (with cutoff and resonance lanes), the delay send (with feedback and mix lanes), and the reverb send are applied per track; mute always silences a track and any solo silences unsoloed tracks. Pan uses an equal-power law (-1 left, 1 right). The delay is a stereo ping-pong (first repeat on the panned side, later repeats alternate) and the reverb is a Freeverb-style network of eight parallel damped combs and four series allpasses per channel, with the right channel's delay lines offset for width; both use only integer delay lengths and fixed coefficients, so renders stay deterministic.

Audio engine. With `dawgd` running only the daemon plays audio; on the file-lock fallback a per-session audio lock keeps multiple TUI windows from starting duplicate voices. The engine renders one loop with every tail (release, delay, reverb) folded back onto the loop start, so the buffer repeats seamlessly, and streams it as raw s16le stereo into one long-lived player process, paced by the wall clock with about 200 ms queued. An edit renders the new loop and swaps it in at the current loop position without restarting the player; a tempo change keeps the musical beat; a seek or a drift above 30 ms re-anchors the write position to the shared transport clock, offset by the queued audio, so the transport matches what you hear. Backends, in order: `ffplay -f s16le -i -`, then SoX `play -t raw -`, then (macOS) `afplay` re-rendering a loop-folded WAV rotated to the current beat on each edit, the only backend that restarts. `DAWG_AUDIO_BACKEND=ffplay|sox|afplay|none` forces one, `DAWG_AUDIO_PLAYER="cmd {rate} {channels}"` streams into any stdin player, and `DAWG_AUDIO=0` disables sound. `dawg auth status` and `/auth` print the detected backend. The renderer is deterministic and independently testable; a native or sample-backed instrument backend can replace it behind the same player port.
Set `DAWG_AUDIO=0` for headless sessions.

Use `DAWG_DEMO=1 bun run src/main.ts` for a deterministic non-interactive frame stream while developing the renderer.

## Project files and SDK

A directory with a `dawg.json` is a project: its score lives in typechecked TypeScript files that you, an editor or the agent can edit, and every window keeps those files and the session in step. `dawg init [dir]` creates one and is idempotent; it never touches anything outside the target.

```text
dawg.json                  {"format":"dawg.project/v1","sdk":1}
tsconfig.json              extends .dawg/sdk/tsconfig.json; paths {"dawg": ["./.dawg/sdk/v1.ts"]}
song.ts                    tempo, meter, bars, key, track order; imports tracks/*/track.ts
tracks/<slug>/track.ts     one track: instrument or sampler, mix, effects, automation, notes
tracks/<slug>/samples/     audio a sampler references by relative path
.dawg/sdk/v1.ts            vendored SDK (committed), refreshed by init when a newer 1.x ships
.dawg/sync.json            hashes of the files dawg last wrote (runtime, gitignored)
.dawg/tsbuild/             incremental typecheck state (runtime, gitignored)
```

`init` appends `.dawg/*` and `!.dawg/sdk/` to `.gitignore`, so sessions and caches stay local while the vendored SDK is committed with the project. The slug is `trackSlug(name)` from `core/slug.ts`; duplicates get `-2`, `-3`. The full design is in [docs/project-format.md](./docs/project-format.md).

SDK. `core/sdk/v1.ts` is one dependency-free file with JSDoc on every export, because its signatures are what an agent reads. Authors write beats; `song()` returns a `track.loop/v1` document in integer ticks (`round(beat × ticksPerBeat)`). Builders: `note(pitch, start, length = 1, velocity = 0.8)`, `seq("E2 . G2", {from, step, len, vel})` (`.`, `-`, `_` rest), `hit(voice, start, velocity, length = 0.25)` and `hits(voice, beats)` for `kit` voices (`kick`, `snare`, `hat`, …) and sampler voices, `every(step, {from, until})`, `sampler(voices, {mode})`, `slices(src, count)`, `chord(symbol, start, length, opts)`, `progression(chords, opts)` (see [Chords](#chords)), `track({...})` and `song({...})`. Note ids are content hashes, so the files never carry them and dawg keeps the session's ids for notes that did not change.

Evaluation. `evaluateProject(dir)` (`core/sdk/eval.ts`) imports `song.ts` in a fresh `bun --no-addons --no-install` child with cwd at the project, an environment of only `PATH`, `HOME` and `TMPDIR`, a 10 s timeout and 1 MiB of output, then decodes the document through the ordinary score validator. Failures are diagnostics `file:line:col message`, never throws. Evaluation is a guard against mistakes, not a sandbox: project code runs with your user's file access, like any build script.

Typecheck. `typecheckProject(dir)` (`src/project/typecheck.ts`) runs the native TypeScript 7 compiler from the `typescript` dependency with `--incremental` state in `.dawg/tsbuild`. A cold check of a three-track project takes about 65 ms and a warm one about 26 ms on an M-series Mac. The header shows `types ✓` or `types ✗ N`.

Two-way sync (`src/project/sync.ts`) runs in every window of a project:

- Files to score: `fs.watch` on the project and `tracks/` (plus a 1.5 s poll) with a 150 ms debounce. A changed source is evaluated, its notes adopt the session's ids, and `diffScores` (`core/diff.ts`) turns the difference into the smallest list of score operations, committed as one `files.apply` revision through the session port, so dawgd rebases it like an agent intent and undo drops it as one step. The window shows `applied from files · 2 notes, 1 track`. A file that fails to evaluate leaves the score untouched and shows `files rejected · <diagnostic>` once per distinct error.
- Score to files: after any accepted revision (TUI, agent, another window) the window reprints only the files whose bytes would change. A file whose evaluation already equals the score is never rewritten, so hand formatting and comments survive until the content they describe changes. A track file left behind by a rename or removal is deleted only if its hash still matches what dawg wrote; a hand-edited one is kept.
- Startup: if any source differs from the hash in `.dawg/sync.json` (edited while dawg was closed, or never written by dawg), the files win; otherwise the session wins and the files are reprinted.
- Echo: a window skips files whose hashes it already evaluated; another window's write costs one no-op evaluation.
- The agent's `write_file`/`edit_file` on a `.ts` source applies before the tool result returns; the result carries the outcome line, `types ✓` or `types ✗ N` and up to eight diagnostics.

The printer (`core/sdk/print.ts`) is deterministic and Prettier-stable (`prettier --check` passes on its output), prints only non-default fields, and satisfies `print(evaluate(print(score))) = print(score)`.

`dawg check` typechecks and evaluates the project, prints diagnostics to stderr and `ok · 3 tracks, 12 notes · types 26 ms · eval 21 ms` on success, and exits 1 on any problem or outside a project.

Score format. The score stays `track.loop/v1` with `version: 1`: every addition is an optional field, so older documents still parse and older dawg versions reject only documents that use the new fields. Tracks may carry `sampler: {mode: "oneshot" | "keyed", voices: {name: {src, sha256?, url?, license?, root?, begin?, end?, gain?, speed?, loop?, choke?}}}` with bounds in `SCORE_LIMITS` (64 voices, 256-character relative `src`, gain ≤ 2, speed ≤ 8). One-shot voices map to pitches from 36 in voice-name order. Sampler tracks play their samples; see [Samples](#samples). `diffScores` uses four operations added alongside: `removeTrack`, `moveTrack`, `setKey` and `setMeter`, which dawgd rebases and the planner accepts.

## Effects

Every track has one fixed effects chain (`FX_CHAIN` in `core/fx.ts`, DSP in `src/audio/effects/`):

```text
filter → djf → autofilter → vowel → crush → distort → tremolo → compressor → pan → phaser → chorus → leslie → postgain → delay → reverb → [mix: orbit → duck]
```

Stages before `pan` run on the track's mono voice sum; pan spreads it to stereo with the equal-power law; the rest run on the stereo pair. An effect that is off costs nothing. The core set — **filter, auto filter, distortion, tremolo, compressor, chorus, delay, reverb** — leads the Effects menu and the agent brief; dj filter, vowel, bitcrush, phaser, leslie, post gain, orbit and duck are under **more effects** for Strudel parity.

`orbit` and `duck` act where track stems are summed (`src/audio/effects/duck.ts`). Every track plays on an orbit (1 unless `fx orbit <n>` sets one). A track with `duck` is a sidechain trigger: each of its note onsets dips every other audible track on the target orbit by `depth`, reaching it over `onset` and recovering linearly over `attack`. Overlapping dips take the deepest; a ducker never ducks itself; loop renders wrap a dip across the loop end. The gain is computed from note onsets, not audio, so it is deterministic and costs one multiply per sample on ducked tracks. Typical use: `fx orbit 2` on the pad and bass, `fx duck preset pump` on the kick.

**Orbit buses** (`src/audio/effects/bus.ts`): `fx orbit shared on` makes a track send to its orbit's one shared delay and one shared reverb instead of running its own, as Strudel orbits do. Each member's stem (its chain up to delay) feeds the bus delay at its `delay.mix` and the bus reverb at its `reverb.mix`, both following their lanes; the bus delay's time, feedback, ping-pong and high-cut come from the first member in score order with a delay, the bus reverb's settings from the first member with a reverb. The two run in parallel and join the mix after the stems. Both are linear, so a one-member bus sounds exactly like that track's own delay and reverb; tracks without `shared` are unaffected.

**Convolution reverb** (`src/audio/effects/convolution.ts`, Strudel `iresponse`/`ir`): `fx reverb ir hall` (or `fx ir hall`) convolves with a generated impulse, `room`, `hall` or `plate`; `fx ir pack:<pack>/<sound>` or `fx ir samples/church.wav` uses a sample, pinned by sha256 like sampler files; `fx ir off` returns to the algorithmic tail. `mix` and `predelay` still apply; `size`, `fade` and `dim` do not. Uniformly partitioned FFT convolution, energy-normalized so a given `mix` sounds about as loud as the algorithmic tail; impulses are cut at 10 s.

`filter`, `delay` and `reverb` stay where they were on the track (older documents decode and render byte-for-byte as before; the new fields `filter.type`/`ftype`, `delay.time`/`pingpong`/`highcut` and `reverb.fade`/`lowpass`/`dim`/`predelay` are optional). The other effects live in `track.fx` keyed by name, and their parameter lanes in `track.fxAutomation` keyed `<effect>-<param>` (`autofilter-cutoff`, `distort-drive`, `reverb-mix`…). Omitted parameters take the defaults below, and turning an effect on with no parameters gives a good starting sound: the delay is a 3/16 (dotted-eighth) stereo ping-pong with feedback 0.35, mix 0.25 and a 5 kHz high-cut on the repeats.

Prompt grammar (one undo step per command; parameter names are dawg's or any Strudel name in the table):

```text
fx                                       list the focused track's effects
fx <effect> on|off|reset                 on with defaults, remove, back to defaults
fx <effect> preset <name>                load a preset
fx <effect> <param> <value> [<param> <value> …]
fx delay mix 0.3                         fx filter type hpf cutoff 300
fx distort drive 4 tone 5000             fx autofilter shape random sync 0.25
fx tremolo depth 0.8                     fx delay delayfeedback 0.4
fx orbit 2                               fx duck preset pump   (one number sets the first param)
automate distort-drive points 0:1 8:6    every numeric fx param has a lane
```

Aliases: `dist`, `comp`, `room`, `bitcrush`, `trem`, `auto-filter`, `bus`/`o` (orbit), `sidechain`/`duckorbit` (duck), `lpf`/`hpf`/`bpf` (filter with that type). The menu's Effects section opens each effect on its on/off toggle, presets and simple parameters; **advanced** lists every parameter with its Strudel names. The agent's `set_fx` tool takes the same names and presets.

Presets: filter `warm dark acid thin telephone`; autofilter `slow-sweep wobble s&h hpf-rise env-follow`; distort `warm crunch fuzz fold shape`; tremolo `gentle eighth-chop pulse`; compressor `gentle punch squash`; chorus `subtle wide seasick`; delay `ping-pong dotted-eighth slapback dub`; reverb `room hall plate ambient`; djf `dark thin`; vowel `a o ee`; crush `8-bit lofi destroy`; phaser `slow fast`; leslie `fast slow`; duck `pump subtle gate`.

The DSP is clean-room, written from public documentation of the parameters and standard literature (RBJ biquads, a Stilson/Smith-style ladder, Freeverb-style combs and allpasses, the Giannoulis–Massberg–Reiss compressor), not from Strudel or superdough source (AGPL). Renders stay deterministic: the random S&H shape hashes the cycle index, so cold, cached and worker renders are byte-identical (`src/audio/renderer.test.ts`).

Parameters (**bold** effect = shown in the simple menu; Lane = automation lane):

| Effect         | Param               | Range                                                                             | Default | Strudel                                                        | Lane                   |
| -------------- | ------------------- | --------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- | ---------------------- |
| **filter**     | type (optional)     | lpf / hpf / bpf                                                                   | lpf     | `lpf`, `hpf`, `bpf`                                            |                        |
| filter         | ftype (optional)    | 12db / 24db / ladder                                                              | 12db    | `ftype`                                                        |                        |
| **filter**     | cutoff              | 20..20000 Hz                                                                      | 2000    | `lpf`, `cutoff`, `ctf`, `lp`, `hpf`, `hcutoff`, `bpf`, `bandf` | `filter`               |
| **filter**     | resonance           | 0..1                                                                              | 0       | `lpq`, `resonance`, `hpq`, `hresonance`, `bpq`, `bandq`        | `resonance`            |
| **djf**        | value               | 0..1                                                                              | 0.5     | `djf`                                                          | `djf-value`            |
| **autofilter** | type                | lpf / hpf / bpf                                                                   | lpf     | `ftype-like: lpf/hpf/bpf`                                      |                        |
| **autofilter** | cutoff              | 20..20000 Hz                                                                      | 1200    | `lpf`, `cutoff`                                                | `autofilter-cutoff`    |
| autofilter     | resonance           | 0..1                                                                              | 0.3     | `lpq`, `resonance`                                             | `autofilter-resonance` |
| **autofilter** | depth               | 0..6 oct                                                                          | 2       |                                                                | `autofilter-depth`     |
| **autofilter** | sync                | 0..64 beats                                                                       | 4       |                                                                |                        |
| autofilter     | rate                | 0.01..40 Hz                                                                       | 0.5     |                                                                | `autofilter-rate`      |
| **autofilter** | shape               | sine / tri / square / saw / ramp / random                                         | sine    |                                                                |                        |
| autofilter     | phase               | 0..1                                                                              | 0       |                                                                |                        |
| autofilter     | follow              | -6..6 oct                                                                         | 0       | `lpenv (per note, see synth)`                                  | `autofilter-follow`    |
| **vowel**      | vowel               | a / e / i / o / u / ae / aa / oe / ue / y / uh / un / en / an / on                | a       | `vowel`                                                        |                        |
| **vowel**      | mix                 | 0..1                                                                              | 1       |                                                                | `vowel-mix`            |
| **crush**      | bits                | 1..16                                                                             | 8       | `crush`                                                        | `crush-bits`           |
| **crush**      | coarse              | 1..64                                                                             | 1       | `coarse`                                                       |                        |
| **crush**      | mix                 | 0..1                                                                              | 1       |                                                                | `crush-mix`            |
| **distort**    | drive               | 0..10                                                                             | 2       | `distort`, `dist`                                              | `distort-drive`        |
| distort        | type                | soft / hard / cubic / diode / asym / fold / sinefold / chebyshev / scurve / shape | soft    | `distort type (3rd field)`, `shape → type shape`               |                        |
| **distort**    | tone                | 200..20000 Hz                                                                     | 8000    |                                                                | `distort-tone`         |
| **distort**    | mix                 | 0..1                                                                              | 1       |                                                                | `distort-mix`          |
| distort        | postgain            | 0..2                                                                              | 1       | `distort postgain`                                             |                        |
| **tremolo**    | sync                | 0..64 beats                                                                       | 0.5     | `tremolosync`, `tremsync`                                      |                        |
| tremolo        | rate                | 0.01..40 Hz                                                                       | 4       | `tremolo`                                                      | `tremolo-rate`         |
| **tremolo**    | depth               | 0..1                                                                              | 0.5     | `tremolodepth`, `tremdepth`                                    | `tremolo-depth`        |
| **tremolo**    | shape               | sine / tri / square / saw / ramp                                                  | sine    | `tremoloshape`, `tremshape`                                    |                        |
| tremolo        | skew                | 0..1                                                                              | 0.5     | `tremoloskew`, `tremskew`                                      |                        |
| tremolo        | phase               | 0..1                                                                              | 0       | `tremolophase`, `tremphase`                                    |                        |
| **compressor** | threshold           | -60..0 dB                                                                         | -18     | `compressor threshold`                                         | `compressor-threshold` |
| **compressor** | ratio               | 1..20                                                                             | 4       | `compressorRatio`                                              |                        |
| compressor     | knee                | 0..24 dB                                                                          | 6       | `compressorKnee`                                               |                        |
| compressor     | attack              | 0.0001..1 s                                                                       | 0.01    | `compressorAttack`                                             |                        |
| compressor     | release             | 0.01..2 s                                                                         | 0.15    | `compressorRelease`                                            |                        |
| **compressor** | makeup              | 0..24 dB                                                                          | 5       |                                                                | `compressor-makeup`    |
| **phaser**     | rate                | 0.01..40 Hz                                                                       | 0.5     | `phaser`, `ph`                                                 | `phaser-rate`          |
| phaser         | sync                | 0..64 beats                                                                       | 0       |                                                                |                        |
| **phaser**     | depth               | 0..1                                                                              | 0.75    | `phaserdepth`, `phd`, `phasdp`                                 | `phaser-depth`         |
| phaser         | center              | 100..10000 Hz                                                                     | 1000    | `phasercenter`, `phc`                                          |                        |
| phaser         | sweep               | 0..8000 Hz                                                                        | 2000    | `phasersweep`, `phs`                                           |                        |
| **chorus**     | rate                | 0.01..40 Hz                                                                       | 0.8     |                                                                | `chorus-rate`          |
| **chorus**     | depth               | 0..1                                                                              | 0.4     |                                                                | `chorus-depth`         |
| **chorus**     | mix                 | 0..1                                                                              | 0.5     |                                                                | `chorus-mix`           |
| **leslie**     | mix                 | 0..1                                                                              | 1       | `leslie`                                                       | `leslie-mix`           |
| **leslie**     | rate                | 0.01..40 Hz                                                                       | 6.7     | `lrate`                                                        | `leslie-rate`          |
| leslie         | size                | 0..1                                                                              | 0.5     | `lsize`                                                        |                        |
| **postgain**   | gain                | 0..4                                                                              | 1       | `postgain`, `post`                                             | `postgain-gain`        |
| **delay**      | beats               | 0.0625..4 beats                                                                   | 0.75    | `delaytime (seconds = beats·60/bpm)`                           |                        |
| **delay**      | feedback            | 0..0.9                                                                            | 0.35    | `delayfeedback`, `delayfb`, `dfb`                              | `delay-feedback`       |
| **delay**      | mix                 | 0..1                                                                              | 0.25    | `delay`                                                        | `delay-mix`            |
| delay          | time (optional)     | 0..4 s                                                                            | 0       | `delaytime`, `delayt`, `dt`                                    |                        |
| delay          | pingpong (optional) | on/off                                                                            | true    |                                                                |                        |
| delay          | highcut (optional)  | 500..20000 Hz                                                                     | 5000    |                                                                |                        |
| **reverb**     | mix                 | 0..1                                                                              | 0.3     | `room`                                                         | `reverb-mix`           |
| **reverb**     | size                | 0..1                                                                              | 0.5     | `roomsize`, `rsize`, `sz`, `size`                              |                        |
| reverb         | fade (optional)     | 0.1..20 s                                                                         | 2       | `roomfade`, `rfade`                                            |                        |
| reverb         | lowpass (optional)  | 200..20000 Hz                                                                     | 8000    | `roomlp`, `rlp`                                                |                        |
| reverb         | dim (optional)      | 200..20000 Hz                                                                     | 3000    | `roomdim`, `rdim`                                              |                        |
| reverb         | predelay (optional) | 0..0.5 s                                                                          | 0.02    |                                                                |                        |
| reverb         | ir (optional)       | `builtin:room\|hall\|plate`, pack sound or project WAV                            | off     | `iresponse`, `ir`                                              |                        |
| orbit          | orbit               | 1..16 (integer)                                                                   | 2       | `orbit`, `o`                                                   |                        |
| orbit          | shared (optional)   | on/off                                                                            | off     |                                                                |                        |
| duck           | orbit               | 1..16 (integer)                                                                   | 1       | `duckorbit`, `duck`                                            |                        |
| duck           | depth               | 0..1                                                                              | 1       | `duckdepth`                                                    |                        |
| duck           | attack              | 0.001..4 s                                                                        | 0.1     | `duckattack`, `duckatt`, `datt`                                |                        |
| duck           | onset               | 0..0.5 s                                                                          | 0.003   | `duckonset`                                                    |                        |

Strudel mapping notes: Strudel's `lpf`/`hpf`/`bpf` each set a separate filter; dawg has one track filter whose `type` selects the response, so `lpf(800)` is `filter {type: "lpf", cutoff: 800}` and `lpq`/`hpq`/`bpq` map to `resonance`. `delay` in Strudel is the wet level (dawg `delay.mix`), `delaytime` is seconds (dawg `delay.time`; `beats` is the tempo-synced form), `delayfeedback` is `delay.feedback`. `room` is `reverb.mix`, `size`/`roomsize` is `reverb.size`, `roomfade`/`roomlp`/`roomdim` are `fade`/`lowpass`/`dim`. `distort` and `shape` are the distortion drive with `type: "shape"` for Strudel's `shape` curve; `crush` is bits and `coarse` is the sample-hold factor. `phaser`/`phaserdepth`/`phasercenter`/`phasersweep`, `tremolo*`, `leslie`/`lrate`/`lsize`, `postgain` and `compressor` keep their names. `orbit` groups tracks for `duckorbit`/`duckdepth`/`duckattack`/`duckonset` sidechaining; By default each track keeps its own delay and reverb; `fx orbit 2 shared on` makes the track send to its orbit's one shared delay and reverb, as Strudel orbits do (see **Orbit buses**). `iresponse`/`ir` is `reverb.ir`.

## Master and loudness

The song master is an optional chain after every track, orbit bus and duck are summed: **EQ** (low shelf, two bells, high shelf) → **glue** (stereo-linked bus compressor with soft knee, parallel mix and a sidechain high-pass) → **tape** (saturation with bias and a tone roll-off) → **width** (mid/side, mono below a cutoff) → **limiter** (true-peak brickwall with lookahead). A song with no master renders byte-identically to 0.4; an absent unit is skipped and a 0 dB EQ band is skipped.

| Command                                  | Does                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `master glue on` / `master glue off`     | a unit with defaults, or drop it                                                                                                                                                                                                      |
| `master glue preset glue`                | presets: eq `air warm mud-cut smile`, glue `gentle glue pump`, tape `warm hot crush`, width `narrow wide vinyl` (vinyl: mono below 150 Hz), limiter `transparent loud brick`                                                          |
| `master glue ratio 4`                    | one parameter (turns the unit on)                                                                                                                                                                                                     |
| `master streaming` / `master target -14` | a loudness target by name or LUFS; `master -14` and `master on` (streaming) are shorthands, as are `master spotify`/`youtube`/`tidal`; a positive number is read as negative LUFS and the reply says so; `master target off` drops it |
| `master measure`                         | integrated, short-term max and momentary max LUFS, loudness range, true peak, correlation                                                                                                                                             |
| `master off`                             | remove the master                                                                                                                                                                                                                     |

Targets: `streaming` -14 LUFS / -1 dBTP, `apple` and `podcast` -16, `broadcast` -23 (EBU R 128), `classical` -20, `ambient` -18, `club` -8 / -2 dBTP (with the `loud` limiter) and `loud` -6 / -2 dBTP (with the `brick` limiter, for hyperpop, gabber and hardcore; masters louder than -14 LUFS stay under -2 dBTP because lossy encoding of loud, dense material adds inter-sample overs). With the limiter on, a target sets the limiter's input gain: a bracketing search on the measured integrated loudness that starts from the linear estimate, gives the same answer for the same mix every time, and stops early with `reached: false` once more drive no longer raises the loudness. At -6 LUFS the limiter alone may stop short; `tape preset crush` or a lower glue threshold before it helps; without it, the gain is capped so the true peak stays at or below -1 dBTP, so a quiet target is always met and a loud one may fall short (the measurement says so).

Measurement follows ITU-R BS.1770-4 and EBU R 128: K-weighting derived for any sample rate, 400 ms momentary and 3 s short-term windows (maxima on a 10 ms grid), the -70 LUFS absolute and -10 LU relative gates for integrated loudness, the EBU Tech 3342 loudness range (-20 LU gate, 10th to 95th percentile of short-term values), and true peak from the BS.1770-4 Annex 2 4x oversampling filter. Tests check EBU Tech 3341 cases 1–5, 9–14 (11 and 14 modelled) and 15–19 and Tech 3342 cases 1–4 within their tolerances. The parameters are in `core/master.ts` (`MASTER_SPECS`, `MASTER_PRESETS`, `LOUDNESS_TARGETS`).

Parameters (**bold** unit = shown in the simple menu; the rest are under `advanced`). Glue's `auto` make-up adds half the reduction a full-scale peak gets, so glue on and off compare near level-matched. Clean EQ corners above 0.45 × the render rate are clamped there.

<!-- master-params:start -->

| Unit        | Param     | Range          | Default | Does                                                                                   |
| ----------- | --------- | -------------- | ------- | -------------------------------------------------------------------------------------- |
| **eq**      | low       | -12..12 dB     | 0       | low shelf gain                                                                         |
| eq          | lowfreq   | 20..1000 Hz    | 100     | low shelf corner                                                                       |
| **eq**      | bell1     | -12..12 dB     | 0       | first bell gain                                                                        |
| eq          | bell1freq | 40..16000 Hz   | 400     | first bell centre                                                                      |
| eq          | bell1q    | 0.1..10        | 1       | first bell width: higher is narrower                                                   |
| **eq**      | bell2     | -12..12 dB     | 0       | second bell gain                                                                       |
| eq          | bell2freq | 200..18000 Hz  | 3000    | second bell centre                                                                     |
| eq          | bell2q    | 0.1..10        | 1       | second bell width: higher is narrower                                                  |
| **eq**      | high      | -12..12 dB     | 0       | high shelf gain                                                                        |
| eq          | highfreq  | 1000..20000 Hz | 10000   | high shelf corner                                                                      |
| **glue**    | threshold | -40..0 dB      | -18     | level where compression starts                                                         |
| **glue**    | ratio     | 1..10          | 2       | input:output above threshold (2 and 4 are the classic bus settings)                    |
| **glue**    | attack    | 0.1..30 ms     | 10      | how fast it clamps down; slower lets transients through                                |
| **glue**    | release   | 50..1200 ms    | 300     | how fast it lets go; set it to breathe with the tempo                                  |
| glue        | knee      | 0..12 dB       | 6       | soft-knee width                                                                        |
| **glue**    | makeup    | 0..24 dB       | 0       | gain after compression (on top of auto)                                                |
| **glue**    | auto      | on / off       | on      | automatic make-up (half the reduction at 0 dBFS) so on/off compares near level-matched |
| glue        | mix       | 0..1           | 1       | dry/wet: below 1 is parallel compression                                               |
| glue        | hpf       | 0..400 Hz      | 0       | sidechain high-pass so the bass does not pump the mix; 0 is off                        |
| **tape**    | drive     | 0..24 dB       | 6       | push into the curve: denser and louder                                                 |
| tape        | bias      | 0..0.5         | 0.1     | asymmetry: adds even harmonics                                                         |
| tape        | tone      | 2000..20000 Hz | 20000   | high-frequency roll-off after the curve; 20000 is off                                  |
| **tape**    | mix       | 0..1           | 1       | dry/wet                                                                                |
| **width**   | width     | 0..2           | 1       | side level: 0 is mono, 1 unchanged, 2 twice as wide                                    |
| **width**   | mono      | 0..300 Hz      | 120     | below this the mix is mono (keeps bass centred); 0 is off                              |
| **limiter** | ceiling   | -12..0 dBTP    | -1      | highest true peak out                                                                  |
| **limiter** | gain      | 0..24 dB       | 0       | drive into the limiter (a target sets it itself)                                       |
| **limiter** | release   | 1..1000 ms     | 100     | recovery time; short is louder, long is cleaner                                        |
| limiter     | lookahead | 0.5..10 ms     | 5       | how early gain reduction starts before a peak                                          |
| limiter     | truepeak  | on / off       | on      | catch peaks between samples (4x oversampled detection)                                 |

<!-- master-params:end -->

`dawg render out.wav --normalize streaming` (or a LUFS number) applies a target for that export only, without changing the song; `--measure` prints the loudness line after any render. While the loop plays, the header shows `-14.1 LUFS (-14) · TP -1.0` for the last rendered loop, with or without a master, so you can read a mix before mastering it. The bracket is the target, and the reading turns to a warning colour when it is more than 0.5 LU off the target or the true peak passes the limiter's ceiling (-1 dBTP without one). With a master the loop monitors at the engine's 22,050 Hz while exports and `master measure` run at 48 kHz; the header shows the 48 kHz reading once it is measured in the background (a `~` marks the monitor estimate until then). EQ above about 9.9 kHz is not audible while monitoring but is in the export. The menu has it under **Mix & automation › master** (`/menu master`), where `Space` stages master changes for A/B like other sound edits. The agent has `set_master` and `measure_mix` (integrated, short-term and momentary LUFS, loudness range, true peak, spectral balance in five bands (sub, bass, low-mid, high-mid, high) and stereo correlation, with `bypass_master` to compare); it masters only when asked and measures before and after. In the SDK: `song({ master: { glue: { ratio: 2 }, limiter: { ceiling: -1 }, target: -14 } })` (SDK 1.17.0).

## Synth

A synth track's voice is shaped by `track.synth`, a map of Strudel (superdough) parameter names to values. Parameter names are Strudel's wherever one means the same thing, and every Strudel alias is accepted on input (`att`, `lpe`, `fmi`, `vmod`…); the stored and printed form is the canonical name in the table. Only the parameters a document sets are stored, and an unset one takes its default, as in Strudel. A track with no `synth` and one of dawg's original instruments (`sine piano pluck bass saw square triangle`) renders byte-for-byte as before.

Sounds (`instrument`): `sine`, `sawtooth` (`saw` stays the legacy voice until `synth` is set), `square`, `triangle`, `supersaw`, `pulse`, `user` (additive, from `partials`/`phases`), and noise `white`, `pink`, `brown`, `crackle`, plus the ZzFX sounds `z_sine`, `z_triangle`, `z_sawtooth`, `z_square`, `z_tan`, `z_noise`. Aliases: `sin`, `tri`, `sqr`, `noise`/`whitenoise`, `pinknoise`, `brownnoise`. Any oscillator can be mixed with noise (`noise`, and `density` for crackle), detuned into a unison stack (`unison`, `detune`, `spread`), pulse-width modulated (`pw`, `pwrate`, `pwsweep`), and frequency-modulated by up to eight operators (`fm`…`fm8`, each with `fmh`, an ADSR, `fmenv` lin/exp and `fmwave`). The operators modulate the carrier's phase in parallel, each at its own ratio `fmh`. The pitch envelope (`penv` semitones with `pattack/pdecay/psustain/prelease`, `pcurve`, `panchor`) and vibrato (`vib` Hz, `vibmod` semitones) bend pitch. Three per-voice filters (`lpf`, `hpf`, `bpf`, in that order) each have `q`, an envelope depth in octaves (`lpenv`…) and their own ADSR; `ftype` chooses 12 dB, 24 dB or ladder for the low-pass and `fanchor` sets where the envelope sits relative to the cutoff. A filter whose cutoff is unset is off.

ZzFX sounds (`z_*`) run their own small procedural generator (`src/audio/synth/zzfx.ts`) and then the same ADSR and per-voice filters: frequency = note·(1 ± `zrand`) + 500·`slide` Hz/s + 250·`deltaSlide`·t² Hz, plus `pitchJump` Hz once `pitchJumpTime` seconds have passed; `lfo` (seconds) restarts slide and pitch jump every period and sets the period of `tremolo` (volume modulation amount); `zmod` is an FM rate in Hz at ±50 % depth; `noise` jitters the phase increment (on other sounds it mixes pink noise); `curve` bends the wave (sign·|x|^curve, 0 squares it); `zcrush` holds samples (0..1 → 1..100 samples at 44.1 kHz); `zdelay` adds one echo at half level. Strudel documents names and intent, not units, so these units are dawg's.

The oscillator is chosen in one place, `resolveOscillator()` in `src/audio/synth/oscillators.ts`, which maps a sound name to an oscillator factory that can read the track's synth parameters. Another module can add sounds with `registerOscillatorResolver()` and reuse the voice's ADSR, filter envelopes, unison and FM.

Prompt grammar (one undo step per command):

```text
synth                                    list what this track sets
synth preset <name>                      instrument + parameters
synth lpf 800 lpenv 3 lpdecay 0.2        any parameter by name or Strudel alias
synth fm 4 fmh 1.5                       synth adsr 0.01 0.2 0.5 0.3
synth partials 1 0.5 0.33 0.25           additive harmonics (also phases)
synth lpf off                            unset one parameter
synth reset                              unset everything
synth zzfx ,,129,.01,,.15,2             a raw ZzFX array (or paste zzfx(...[…]))
automate synth-lpf points 0:400 8:4000   numeric parameters have lanes
```

Raw ZzFX arrays (Strudel `zzfx([...])`) use ZzFX's documented positional layout: volume→`gain`, randomness→`zrand`, frequency (the note), attack, sustain time (the note's length), release, shape 0–5→`z_sine`/`z_triangle`/`z_sawtooth`/`z_tan`/`z_noise`/`z_square`, shapeCurve→`curve`, `slide`, `deltaSlide`, `pitchJump`, `pitchJumpTime`, repeatTime→`lfo`, `noise`, modulation→`zmod`, bitCrush→`zcrush`, delay→`zdelay`, sustainVolume→`sustain`, `decay`, `tremolo`, filter (> 0 high-pass Hz, < 0 low-pass Hz). Empty slots take ZzFX's defaults; the result is stored as the named controls, so it prints and edits like any synth track. The SDK has `zzfx([...])` to spread into `track({...})` and `set_synth` takes `zzfx`.

Presets: `pad` (supersaw: slow, wide detuned saws through a soft low-pass), `lead` (sawtooth: bright saw with a short filter blip and delayed vibrato feel), `pluck` (pulse: short percussive pulse with a fast filter envelope), `bass` (sawtooth: round saw bass, 24 dB low-pass with a little bite), `sub` (sine: clean sine sub with a tiny pitch drop on each note), `acid` (sawtooth: ladder low-pass with high resonance and a snappy envelope), `keys` (sine: electric-piano style 1:1 FM with a decaying modulator), `bell` (sine: inharmonic FM bell with a long ring), `organ` (user: drawbar-style additive organ with a gentle vibrato), `strings` (supersaw: softer ensemble: slow attack, gentle vibrato, darker filter), `brass` (sawtooth: filter swell on attack like a brass section), `wind` (pink: breathy band-passed noise that swells and fades), `chip` (pulse: 8-bit square lead with slow pulse-width motion), `zap` (z_square: ZzFX laser zap: a square that dives in pitch).

The menu's **Parameters** section shows the instrument, preset and the simple parameters (ADSR, lpf/lpq/lpenv, detune, vib, fm); **advanced** groups every parameter (amplitude, oscillator, vibrato, pitch envelope, the three filters, FM 1–8, ZzFX, partials) with its Strudel aliases. The agent's `set_synth` tool takes the same names and presets.

Automation lanes `synth-<param>` are read at each note's onset, as Strudel reads a patterned control once per event. Note velocity scales the voice as Strudel's `velocity` does, and `gain` is the voice gain before the effects chain.

The DSP is dawg's own, clean-room from public documentation and standard literature (PolyBLEP oscillators, Paul Kellet's pink-noise filter, leaky-integrated brown noise, RBJ biquads and a Stilson/Smith-style ladder, linear and exponential ADSRs, phase-modulation FM), not from Strudel or superdough source (AGPL-3.0). Noise comes from a PRNG seeded by each note, so renders stay byte-identical across cold, cached and worker paths.

| Param         | Range                               | Default | Strudel names                | Lane                  |
| ------------- | ----------------------------------- | ------- | ---------------------------- | --------------------- |
| **attack**    | 0..10 s                             | 0.003   | `attack`, `att`              | `synth-attack`        |
| **decay**     | 0..10 s                             | 0.05    | `decay`, `dec`               | `synth-decay`         |
| **sustain**   | 0..1                                | 1       | `sustain`, `sus`             | `synth-sustain`       |
| **release**   | 0..10 s                             | 0.05    | `release`, `rel`             | `synth-release`       |
| gain          | 0..4                                | 1       | `gain`                       | `synth-gain`          |
| noise         | 0..1                                | 0       | `noise`                      | `synth-noise`         |
| density       | 0..1                                | 0.03    | `density`                    | `synth-density`       |
| unison        | 1..16                               | 1       | `unison`                     |                       |
| **detune**    | 0..12 st                            | 0.2     | `detune`                     | `synth-detune`        |
| spread        | 0..1                                | 0.6     | `spread`                     | `synth-spread`        |
| pw            | 0..1                                | 0.5     | `pw`                         | `synth-pw`            |
| pwrate        | 0..40 Hz                            | 1       | `pwrate`                     | `synth-pwrate`        |
| pwsweep       | 0..1                                | 0       | `pwsweep`                    | `synth-pwsweep`       |
| **vib**       | 0..64 Hz                            | 0       | `vib`, `vibrato`, `v`        | `synth-vib`           |
| vibmod        | 0..24 st                            | 0.5     | `vibmod`, `vmod`             | `synth-vibmod`        |
| penv          | -48..48 st                          | 0       | `penv`                       | `synth-penv`          |
| pattack       | 0..10 s                             | 0.2     | `pattack`, `patt`            | `synth-pattack`       |
| pdecay        | 0..10 s                             | 0       | `pdecay`, `pdec`             | `synth-pdecay`        |
| psustain      | 0..1                                | 1       | `psustain`, `psus`           | `synth-psustain`      |
| prelease      | 0..10 s                             | 0       | `prelease`, `prel`           | `synth-prelease`      |
| pcurve        | 0..1                                | 0       | `pcurve`                     |                       |
| panchor       | 0..1                                | 0       | `panchor`                    |                       |
| **lpf**       | 20..20000 Hz                        | 2000    | `lpf`, `cutoff`, `ctf`, `lp` | `synth-lpf`           |
| **lpq**       | 0..50                               | 1       | `lpq`, `resonance`           | `synth-lpq`           |
| **lpenv**     | -10..10 oct                         | 0       | `lpenv`, `lpe`               | `synth-lpenv`         |
| lpattack      | 0..10 s                             | 0.005   | `lpattack`, `lpa`            | `synth-lpattack`      |
| lpdecay       | 0..10 s                             | 0.15    | `lpdecay`, `lpd`             | `synth-lpdecay`       |
| lpsustain     | 0..1                                | 0       | `lpsustain`, `lps`           | `synth-lpsustain`     |
| lprelease     | 0..10 s                             | 0.1     | `lprelease`, `lpr`           | `synth-lprelease`     |
| hpf           | 20..20000 Hz                        | 200     | `hpf`, `hcutoff`, `hp`       | `synth-hpf`           |
| hpq           | 0..50                               | 1       | `hpq`, `hresonance`          | `synth-hpq`           |
| hpenv         | -10..10 oct                         | 0       | `hpenv`, `hpe`               | `synth-hpenv`         |
| hpattack      | 0..10 s                             | 0.005   | `hpattack`, `hpa`            | `synth-hpattack`      |
| hpdecay       | 0..10 s                             | 0.15    | `hpdecay`, `hpd`             | `synth-hpdecay`       |
| hpsustain     | 0..1                                | 0       | `hpsustain`, `hps`           | `synth-hpsustain`     |
| hprelease     | 0..10 s                             | 0.1     | `hprelease`, `hpr`           | `synth-hprelease`     |
| bpf           | 20..20000 Hz                        | 1000    | `bpf`, `bandf`, `bp`         | `synth-bpf`           |
| bpq           | 0..50                               | 1       | `bpq`, `bandq`               | `synth-bpq`           |
| bpenv         | -10..10 oct                         | 0       | `bpenv`, `bpe`               | `synth-bpenv`         |
| bpattack      | 0..10 s                             | 0.005   | `bpattack`, `bpa`            | `synth-bpattack`      |
| bpdecay       | 0..10 s                             | 0.15    | `bpdecay`, `bpd`             | `synth-bpdecay`       |
| bpsustain     | 0..1                                | 0       | `bpsustain`, `bps`           | `synth-bpsustain`     |
| bprelease     | 0..10 s                             | 0.1     | `bprelease`, `bpr`           | `synth-bprelease`     |
| ftype         | 12db / 24db / ladder                | 12db    | `ftype`                      |                       |
| fanchor       | 0..1                                | 0       | `fanchor`                    | `synth-fanchor`       |
| **fm**        | 0..64                               | 0       | `fm`, `fmi`                  | `synth-fm`            |
| fmh           | 0..32                               | 1       | `fmh`                        | `synth-fmh`           |
| fmattack      | 0..10 s                             | 0       | `fmattack`, `fmatt`          | `synth-fmattack`      |
| fmdecay       | 0..10 s                             | 0       | `fmdecay`, `fmdec`           | `synth-fmdecay`       |
| fmsustain     | 0..1                                | 1       | `fmsustain`, `fmsus`         | `synth-fmsustain`     |
| fmrelease     | 0..10 s                             | 0       | `fmrelease`, `fmrel`         | `synth-fmrelease`     |
| fmenv         | lin / exp                           | lin     | `fmenv`, `fme`               |                       |
| fmwave        | sine / sawtooth / square / triangle | sine    | `fmwave`                     |                       |
| zrand         | 0..1                                | 0       | `zrand`                      | `synth-zrand`         |
| curve         | 0..3                                | 1       | `curve`                      | `synth-curve`         |
| slide         | -20..20                             | 0       | `slide`                      | `synth-slide`         |
| deltaSlide    | -20..20                             | 0       | `deltaSlide`                 | `synth-deltaSlide`    |
| pitchJump     | -2000..2000 Hz                      | 0       | `pitchJump`                  | `synth-pitchJump`     |
| pitchJumpTime | 0..10 s                             | 0       | `pitchJumpTime`              | `synth-pitchJumpTime` |
| lfo           | 0..10 s                             | 0       | `lfo`                        | `synth-lfo`           |
| zmod          | 0..1000 Hz                          | 0       | `zmod`                       | `synth-zmod`          |
| zcrush        | 0..1                                | 0       | `zcrush`                     | `synth-zcrush`        |
| zdelay        | 0..1 s                              | 0       | `zdelay`                     | `synth-zdelay`        |
| tremolo       | 0..1                                | 0       | `tremolo`                    | `synth-tremolo`       |
| partials      | up to 64 numbers -1..1              | —       | `partials`                   |                       |
| phases        | up to 64 numbers 0..1               | —       | `phases`                     |                       |

FM operators 2–8 repeat the `fm` rows with a suffix (`fm2`, `fmh2`, `fmattack2` … `fmwave8`), each with its lane.

### Strudel parity

| Strudel                                                                                                                                                                 | dawg                                                           | Status                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| `s`/`sound` sine, sawtooth, square, triangle, supersaw, pulse, user, white, pink, brown, crackle                                                                        | `instrument`                                                   | done                                                 |
| `noise`, `density`                                                                                                                                                      | `synth.noise`, `synth.density`                                 | done                                                 |
| `unison`, `spread`, `detune`                                                                                                                                            | `synth.*`                                                      | done                                                 |
| `pw`, `pwrate`, `pwsweep`                                                                                                                                               | `synth.*`                                                      | done                                                 |
| `fm`/`fmi`, `fmh`, `fmattack/fmdecay/fmsustain/fmrelease`, `fmenv`, `fmwave`, operators 2–8                                                                             | `synth.*`                                                      | done                                                 |
| `attack/decay/sustain/release`, `adsr`, `gain`, `velocity`                                                                                                              | `synth.*`; `adsr` is command shorthand; velocity is the note's | done                                                 |
| `penv`, `pattack/pdecay/psustain/prelease`, `pcurve`, `panchor`                                                                                                         | `synth.*`                                                      | done                                                 |
| `vib`/`vibrato`, `vibmod`                                                                                                                                               | `synth.*`                                                      | done                                                 |
| `lpf/hpf/bpf`, `lpq/hpq/bpq`, `lpenv/hpenv/bpenv` and their ADSRs, `ftype`, `fanchor`                                                                                   | `synth.*` (per voice); also the track `filter` effect          | done                                                 |
| `partials`, `phases`                                                                                                                                                    | `synth.partials`, `synth.phases`                               | done                                                 |
| `vowel`, `coarse`, `crush`, `shape`, `distort`, `djf`                                                                                                                   | effects `vowel`, `crush`, `distort`, `djf`                     | done (see Effects)                                   |
| `phaser*`, `tremolo*`, `leslie`/`lrate`/`lsize`, `compressor*`, `postgain`                                                                                              | effects of the same names                                      | done                                                 |
| `room`, `size`, `roomfade`, `roomlp`, `roomdim`                                                                                                                         | `reverb`                                                       | done                                                 |
| `delay`, `delaytime`, `delayfeedback`                                                                                                                                   | `delay`                                                        | done                                                 |
| `pan`                                                                                                                                                                   | track `pan`                                                    | done                                                 |
| `orbit`, `duckorbit`/`duckdepth`/`duckattack`/`duckonset`                                                                                                               | effects `orbit` (+ `shared`), `duck`                           | done: `shared` sends to one delay + reverb per orbit |
| `iresponse`/`ir`                                                                                                                                                        | `reverb.ir`                                                    | done: FFT convolution; built-ins or a pinned sample  |
| `z_sine`…`z_noise`; `zrand`, `curve`, `slide`, `deltaSlide`, `pitchJump`, `pitchJumpTime`, `lfo`, `noise`, `zmod`, `zcrush`, `zdelay`, `tremolo`                        | ZzFX sounds, `synth.*`                                         | done (clean-room; units documented above)            |
| zzfx `duration`                                                                                                                                                         | note length                                                    | done: a note's length is its duration                |
| raw `zzfx([...])` parameter array                                                                                                                                       | `synth zzfx …`, SDK `zzfx([...])`, `set_synth {zzfx}`          | done: ZzFX's documented layout → named controls      |
| soundfonts `gm_*`, drum banks, dirt-samples                                                                                                                             | sampler and sample packs                                       | not this engine: hosted samples, see Sample packs    |
| sample controls `begin`, `end`, `speed`, `unit`, `loop`, `loopBegin`/`loopb`, `loopEnd`/`loope`, `clip`/`legato`, `fit`, `loopAt`, `accelerate`, `squiz`, `cut`, `gain` | sampler voice fields; `/sample set`, `set_sample`              | done (see Samples)                                   |

## Samples

A track whose instrument is `sampler(...)` plays audio files instead of a synth. Voices live in `tracks/<slug>/samples/` and `src` is relative to the track directory (`samples/kick.wav`); a project-relative `tracks/<slug>/samples/kick.wav` works too.

```ts
// tracks/drums/track.ts
import { track, sampler, hits } from "dawg";

export default track({
  name: "drums",
  instrument: sampler({
    kick: "samples/kick.wav",
    hat: { src: "samples/hat.wav", choke: "hats", gain: 0.6 },
    open: { src: "samples/open.wav", choke: "hats" },
  }),
  notes: [
    ...hits("kick", [0, 1, 2, 3]),
    ...hits("hat", [0.5, 1.5]),
    ...hits("open", [3.5]),
  ],
});
```

Semantics follow Strudel's sampler:

| Strudel                                                 | dawg                                                       | Behaviour                                                                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `samples({ kick: "kick.wav" })`                         | `sampler({ kick: "samples/kick.wav" })`                    | one voice per name                                                                                                                               |
| `s("kick hat")`                                         | `hits("kick", …)`, `hit("hat", …)` (oneshot mode)          | voices take pitch slots 36, 37, … in name order; a hit plays the whole sample, whatever the note length                                          |
| `note("c4 e4").s("vox")`                                | `sampler({ vox: { src, root: "C4" } }, { mode: "keyed" })` | rate = 2^((pitch − root)/12); the note's length holds it, then a 10 ms release; several roots multi-sample                                       |
| `.begin(0.25)` / `.end(0.5)`                            | `begin: 0.25`, `end: 0.5`                                  | 0..1 fractions of the file                                                                                                                       |
| `.speed(2)` / `.speed(-1)`                              | `speed: 2` / `speed: -1`                                   | rate and pitch together; negative plays the window backwards                                                                                     |
| `.loop(1)`                                              | `loop: true`                                               | repeats begin..end (5 ms crossfade) for the note's length, oneshot or keyed                                                                      |
| `.cut(1)`                                               | `choke: "hats"`                                            | a new hit in the group stops the sounding voice with a 5 ms fade                                                                                 |
| `.gain(0.8)`                                            | `gain: 0.8`                                                | 0..2, times velocity and the track volume                                                                                                        |
| `.slice(8, …)` / `.chop(8)`                             | `slices("samples/break.wav", 8)`                           | eight voices with begin/end windows                                                                                                              |
| `.loopBegin(0.25)` / `.loopEnd(0.75)` (`loopb`/`loope`) | `loopBegin: 0.25`, `loopEnd: 0.75`                         | with `loop`, the first pass plays from `begin`, then repeats only loopBegin..loopEnd (file fractions inside the window)                          |
| `.clip(1)` / `.legato(1)`                               | `clip: 1`                                                  | the voice lasts note length × clip (then a 10 ms release), cutting a long oneshot                                                                |
| `.fit()`                                                | `fit: true`                                                | the window is stretched or squeezed (by rate, so pitch follows) to last the note                                                                 |
| `.unit("c")`                                            | `unit: "c"`, `speed: n`                                    | `speed` becomes a duration: the window lasts 1/n bars; `unit: "s"`: `speed` seconds                                                              |
| `.loopAt(2)`                                            | `speed: 0.5, unit: "c"` (`/sample set brk loopAt 2`)       | the window lasts 2 bars                                                                                                                          |
| `.accelerate(1)`                                        | `accelerate: 1`                                            | the rate ramps linearly by +1× over the voice (−8..8); a ramp that reaches rate 0 ends the voice                                                 |
| `.squiz(2)`                                             | `squiz: 2`                                                 | each zero-crossing cycle is replayed `squiz`× faster, raising pitch without shortening (1..32; implemented from the Tidal/SuperDirt description) |

`/sample set <voice> <control> <value>…` edits these on the focused sampler track (`/sample set brk fit on clip 1`, `/sample set hat cut hats`, `off` unsets one), each voice in the menu's Parameters section has the same controls, and the agent's `set_sample` tool takes them by name.

Every voice starts and stops with a 1–3 ms fade, so cuts do not click. There is no time-stretch, as in Strudel's default. A sampler track goes through the same volume and pan automation, filter, delay and reverb as any other track and is a cached stem like any other; the stem's cache key includes each voice's sha256, so replacing a file re-renders it.

Decoding: WAV (PCM 16/24/32-bit integer and 32-bit float, any channel count and rate) and AIFF/AIFF-C (8/16/24/32-bit) decode natively, mixed to mono and resampled to the engine rate on the fly with linear interpolation. MP3, FLAC, Ogg, M4A and anything else decode through `ffmpeg` when it is on `PATH` (dawg never installs it); without it the voice is skipped with `<voice> · <path> · not WAV/AIFF and ffmpeg is not on PATH · convert it to WAV, or install ffmpeg (e.g. brew install ffmpeg) and reload`. Decoded PCM is cached at `.dawg/assets/<sha256>.pcm`, least recently used first out past 512 MiB. Files over 50 MiB or 10 minutes, paths that leave the project (including through a symlink), and more than 64 voices are rejected. A `sha256` that no longer matches the file is a warning and the file still plays. Problems appear as receipts in the TUI and on stderr from `dawg render`; the track renders without the missing voices and nothing crashes.

In the TUI, oneshot sampler tracks show one highway lane per voice, labelled by name; keyed tracks use the pitch axis. `/tracks` shows each sampler's sample count and how many failed to load. `/sample <path> [as <voice>]` adds a voice to the focused track: a file outside the track directory is copied into `tracks/<slug>/samples/`, the voice name defaults to the file name, and a focused synth track that already has notes gets a new `samples` track instead. Existing hits keep their voice when the new name shifts the slots. `/sample` alone lists the voices. The agent's `import_sample` media tool writes 48 kHz stereo WAVs to the same folder.

## Sample packs

dawg reads Strudel's sample-pack manifests, so the packs Strudel users know work here, without any Strudel code (Strudel is AGPL; dawg's loader in `src/audio/packs.ts` is written from the documented manifest format only). A manifest is JSON: `{"_base": "<url>/", "<sound>": ["a.wav", "b.wav"] | {"c4": "c4.wav"}}`. A list is a set of variations addressed `<sound>:<n>`; a note map is a keyed instrument. `github:<user>/<repo>[/<branch>]` means `https://raw.githubusercontent.com/<user>/<repo>/<branch or main>/strudel.json`, the rule Strudel documents. General MIDI soundfonts load from gleitz/midi-js-soundfonts' `names.json` and become keyed samplers with one zone per sampled note.

Fetching is lazy. Adding a pack fetches only its manifest. A sample file is fetched the first time a track uses it, decoded, and stored in the existing `.dawg/assets/<sha256>.pcm` cache (with a copy of the raw file in the pack cache), so a pack never lands in the repo or the npm package. Only HTTPS is accepted (loopback HTTP only under `DAWG_PACKS_ALLOW_LOOPBACK_HTTP=1`, for tests), URLs may not carry credentials, every fetch has a timeout, and files keep the same size and duration limits as local samples. Manifests and files are cached under `$XDG_CACHE_HOME/dawg/packs` (default `~/.cache/dawg/packs`; `DAWG_PACKS_DIR` overrides), so a pack sound used once plays offline afterwards.

A sampler voice references a pack sound as `pack:<pack>/<sound>[:<n>]`, like Strudel's `s("bd:3")`; banks follow Strudel's `bank("RolandTR909")` naming (`RolandTR909_bd`). When the sound is first used dawg pins it in the track: `{src: "pack:tidal-drum-machines/RolandTR909_bd", sha256, url, license}`. Renders load the pinned sha256, so they stay reproducible even if the pack changes upstream; a pin whose file no longer matches is reported, not silently replaced. This is an additive field set on `SampleRef`, and older documents decode unchanged.

```ts
instrument: sampler({
  kick: "pack:tidal-drum-machines/RolandTR909_bd",
  hat: "pack:vcsl/hihat:2",
}),
```

| Command                                                    | Does                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/pack` or `/pack list`                                    | the built-in catalog and your added packs, with licenses                                                                                                                                                                                                                                                                                                                                         |
| `/pack add <url \| github:user/repo[/branch]> [as <name>]` | register a manifest (fetches the manifest only)                                                                                                                                                                                                                                                                                                                                                  |
| `/pack info <name>`                                        | license, source, sound names                                                                                                                                                                                                                                                                                                                                                                     |
| `/pack remove <name>`                                      | forget an added pack (built-ins stay)                                                                                                                                                                                                                                                                                                                                                            |
| `/pack use <pack>/<sound>[:<n>] [as <voice>]`              | add one pack sound as a voice on the focused track                                                                                                                                                                                                                                                                                                                                               |
| `/pack cache [prune [<size>] \| clear]`                    | disk used by pack downloads and decoded audio against their caps; `prune` evicts down to the cap (or `<size>`, e.g. `500M`), `clear` evicts everything this project does not use                                                                                                                                                                                                                 |
| `/kit [<kit>]`                                             | with no name, one picker of every kit (synth kits first, then sample kits); a synth kit name (`syn808`, `syn909`, `acoustic`, `lofi`, `electro`, `trap`, `default`) sets the offline drum synth; a bank (`909`, `808`, `707`, `606`, `linn`, `lm1`, `dmx`, `cr78`, `uzu`, `dirt`, or any bank name like `RolandTR909`) turns the focused drum track into a sampler on it; `/kit list` lists both |

**Bank nicknames.** Strudel's REPL registers short names for the drum machines with `aliasBank("https://strudel.b-cdn.net/tidal-drum-machines-alias.json")`, a JSON map of bank → nickname (`{"RolandTR909": "TR909", "AkaiLinn": "Linn", "EmuSP12": "SP12", …}`, 66 entries). dawg ships a snapshot of that file (taken 2026-10-07) so nicknames work offline, and refreshes it whenever it fetches the `tidal-drum-machines` manifest. A nickname works wherever a bank does: `/kit TR909`, `/kit tr808`, `/pack use tidal-drum-machines/TR909`, `pack:tidal-drum-machines/TR909_bd` in `track.ts`, the agent's `use_sound`, and the menu's **Drum kits → Strudel banks** list. Resolution order: a nickname in its exact case (`Linn` → `AkaiLinn`, as in Strudel), then dawg's short names (`909`, `linn` → `LinnDrum`, unchanged from before), then a bank name in any case, then a nickname in any case (`sp12` → `EmuSP12`), then a bank suffix. Pins always store the full bank name (`pack:tidal-drum-machines/RolandTR909_bd`), so documents never depend on alias data.

**Cache sizes.** Pack downloads (`~/.cache/dawg/packs/files/`, shared by every project) are capped at 2 GiB and decoded audio (`<project>/.dawg/assets/`) at 1 GiB per project; `DAWG_PACKS_CACHE_MAX` and `DAWG_ASSETS_CACHE_MAX` override them (`500M`, `4G`, or bytes). Both evict least recently used files first, and neither evicts a file the open project's score uses, even when that project alone is over the cap. An evicted pack file is fetched again from its pinned URL and checked against its pinned sha256 the next time it plays, so eviction only ever costs a download. Manifests are small and never evicted. Decoded samples also share a 512 MiB in-memory LRU per process.

`/menu` (Ctrl-K) has a **Sounds** section: drum kits, instruments (the Salamander piano and `gm_*` soundfonts, Strudel naming), "use a sound", and packs. The agent has `list_packs`, `search_sounds {query}` and `use_sound {sound, track?, voice?}`. A pack sound plays from keyboard play mode like any sampler voice. `kitFromBank(bank)` in `src/audio/packs.ts` returns the voice map for a bank (kick, snare, hat, …) for other kit lists.

Every pack is fully supported, whatever its license; dawg records each sample's pack and license (or `none stated`) in the pinned voice. A render that uses pack sounds names the packs in the WAV's INFO comment and prints a `credits ·` line, and a project that uses a CC-BY or CC-BY-SA pack gets a `CREDITS.md` with the required attribution (dawg leaves a hand-written `CREDITS.md` alone).

Built-in catalog (manifests are the GitHub-raw equivalents of the files Strudel's REPL loads from its CDN; licenses read from each repository on 2026-10-07):

| Pack                  | Manifest                                                                                                           | Samples from                                                          | License                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------- |
| `tidal-drum-machines` | `https://raw.githubusercontent.com/felixroos/dough-samples/main/tidal-drum-machines.json`                          | ritchse/tidal-drum-machines (684 sounds: TR-808, TR-909, LinnDrum, …) | none stated                   |
| `dirt-samples`        | `github:tidalcycles/dirt-samples` → `https://raw.githubusercontent.com/tidalcycles/dirt-samples/main/strudel.json` | tidalcycles/Dirt-Samples (219 sounds)                                 | none stated                   |
| `uzu-drumkit`         | `github:tidalcycles/uzu-drumkit`                                                                                   | tidalcycles/uzu-drumkit                                               | Unlicense                     |
| `vcsl`                | `https://raw.githubusercontent.com/felixroos/dough-samples/main/vcsl.json`                                         | sgossner/VCSL (fetched per file; the repo is ~4 GB)                   | CC0-1.0                       |
| `piano`               | `https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json`                                        | Salamander Grand Piano V3, Alexander Holm                             | CC-BY-3.0                     |
| `mridangam`           | `https://raw.githubusercontent.com/felixroos/dough-samples/main/mridangam.json`                                    | yaxu/mrid, Arthur Carabott 2022                                       | CC-BY-SA-4.0 (per its README) |
| `emu-sp12`            | `https://raw.githubusercontent.com/felixroos/dough-samples/main/EmuSP12.json`                                      | ritchse/tidal-drum-machines                                           | none stated                   |
| `gm`                  | `https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/names.json`                                                | FluidR3_GM via gleitz/midi-js-soundfonts (code MIT)                   | CC-BY-3.0                     |
| `gm-musyngkite`       | `https://gleitz.github.io/midi-js-soundfonts/MusyngKite/names.json`                                                | Musyng Kite via gleitz/midi-js-soundfonts                             | CC-BY-SA-3.0                  |

felixroos/dough-samples, the manifest host, has no license file. Strudel's own `gm_*` sounds come from a different soundfont set; dawg uses FluidR3_GM with the same names.

## Wavetable synth

`instrument: "wavetable"` turns a track into a wavetable oscillator. A wavetable is a stack of single-cycle frames; the position `wt` (0..1) scans across them, mixing neighbouring frames smoothly. Parameter names and meanings follow Strudel's documented controls (`packages/core/controls.mjs` JSDoc on strudel.cc); the oscillator in `src/audio/wavetable.ts` is dawg's own, written from those docs and the WAV format, with no Strudel code.

| Parameter                                    | Range          | Default           | Meaning                                                                   |
| -------------------------------------------- | -------------- | ----------------- | ------------------------------------------------------------------------- |
| `wt`                                         | 0..1           | 0                 | position in the table (automatable: `automate wt points 0:0 4:1`)         |
| `wtenv`                                      | -1..1          | 0                 | position envelope amount, added to `wt`                                   |
| `wtattack` `wtdecay` `wtsustain` `wtrelease` | s, s, 0..1, s  | 0.01, 0.1, 1, 0.1 | position envelope shape                                                   |
| `wtrate` `wtdepth`                           | 0..50 Hz, 0..1 | 0, 0              | sine LFO on the position                                                  |
| `warp` `warpmode`                            | 0..1, mode     | 0, `none`         | bends the read phase: `asym`, `bendp`, `bendm`, `bendmp`, `sync`, `quant` |
| `wtphaserand`                                | 0..1           | 0                 | start phase randomness, seeded per note so renders stay reproducible      |

Tables. Four built-ins are generated in code and work offline: `basic` (sine → triangle → saw → square), `pwm` (pulse 50% → 5%), `formant` (vowels a → e → i → o → u) and `harmonics` (1 → 32 harmonics). Strudel's `wt_` sounds come from the `uzu-wavetables` pack (`github:tidalcycles/uzu-wavetables`, Unlicense) through the normal pack path: `wt_digital:2` means `pack:uzu-wavetables/wt_digital:2`, fetched once, pinned by sha256 and cached like any pack sound. Any other pack sound works too. Frames follow the Serum/Vital WAV convention: a `clm ` chunk reading `<!>2048 …` gives the frame length; otherwise a file whose length is a multiple of 2048 samples is 2048-sample frames, and anything else is one single-cycle frame (the AKWF convention).

Band-limiting. Each frame is kept as its harmonic spectrum and rendered into one table per octave holding only the harmonics below Nyquist for that octave, so a high note never aliases. Tables are oversampled and read with 4-point Hermite interpolation. The arithmetic is plain float64 in a fixed order, so inline, worker and cold or warm cache renders are byte-identical (a renderer parity test checks it).

The wavetable is an oscillator of the synth voice (see [Synth](#synth)): a wavetable track also takes every `synth` parameter, so `attack`/`release`, the `lpf`/`lpenv` filter envelopes, `fm`, `unison`/`detune`/`spread`, `vib` and `penv` shape it as they shape a saw. The band-limit level follows the instantaneous pitch, so vibrato, pitch envelopes and detuned unison voices stay alias-free. Live play mode plays wavetable tracks.

```ts
instrument: wavetable("wt_digital:2", { wt: 0.3, wtenv: 0.5, wtdecay: 0.4, warp: 0.2, warpmode: "bendp" }),
```

| Command                                    | Does                                                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `/wt` · `/wt list`                         | the focused track's wavetable · built-in tables and the `wt_` sets                              |
| `/wt <table>`                              | make the focused track a wavetable track (`basic`, `wt_vgame:3`, `pack:…`, a project `vox.wav`) |
| `/wt <0..1>`                               | set the position                                                                                |
| `/wtenv`, `/wtattack` … `/wtphaserand <n>` | set one parameter; `/warpmode <mode>` sets the warp mode                                        |

The menu's **Parameters** section lists the table picker and every wavetable parameter for a wavetable track, and **Sounds** has a "wavetable synth" row. The agent's `set_wavetable` tool takes the same table names and parameters.

### Wavetables from audio

The agent's `make_wavetable` tool (`src/audio/wavetable-maker.ts`, `src/media/wavetable.ts`; `dawg media wavetable <file> <name>`) builds a table from any audio file in the project:

- **Region.** `start`/`end` in seconds, or automatic: the most stable tonal stretch of up to 2 s (high YIN clarity, steady pitch, enough level), else the loudest 2 s.
- **Method.** `slice` reads one pitch period at each frame's time (YIN-style pitch detection through the FFT), resamples it to 2048 samples with cubic interpolation and spreads the loop-point mismatch over the cycle so it does not click. `spectral` takes, for each frame, the source's magnitude around each harmonic of the reference pitch and uses a fixed phase per harmonic, so frames morph without phase cancellation; it suits vocals, pads and noise. `auto` (the default) picks `slice` when the region is clearly periodic.
- **Clean-up.** DC removed, fundamental rotated to start as a rising sine (so neighbouring frames line up), optional `smooth` across neighbours, and per-frame (default), whole-table or no normalisation to 0.98 peak.
- **Report.** The result gives the path, sha256, frame count, method, region, detected pitch and a short sweep description (spectral centroid per frame span, how smooth the morph is), and the `set_wavetable` call that plays it.

All arithmetic is float64 in a fixed order with no randomness, so the same input and options give the same bytes. Project tables live under `tracks/<slug>/wavetables/`; `/wt list` and the menu's table picker list them, `/wt vox.wav` (or a full `tracks/…` path) picks one for the focused track, and `track.ts` refers to it as `wavetable("./wavetables/vox.wav")`. The score keeps the project path and its sha256; evaluation re-hashes it like sampler files. A file that changed since it was picked plays with a warning; a missing one is a load problem naming `make_wavetable`.

## Rhythm (Euclidean rows)

A drum part can be stored as generators instead of notes: each row owns one voice of a `kit` or oneshot `sampler` track and dawg expands it into ordinary notes, so rendering, diffs and sync are unchanged while you, the agent and `track.ts` edit four numbers instead of sixteen hits. The model follows the Torso T-1's Shape and Groove sections; the Euclidean patterns and rotation match Strudel's `euclid`/`euclidRot` exactly (`E(3,8)` is `x..x..x.`, a positive rotate moves the pattern later).

```ts
// tracks/drums/track.ts
import { track, euclid, grid } from "dawg";

export default track({
  name: "drums",
  instrument: "kit",
  rhythm: [
    euclid("kick", 4, 16),
    euclid("hat", 7, 16, 2, {
      velocity: 0.5,
      accent: 0.6,
      accents: 3,
      swing: 0.15,
    }),
    grid("snare", "....X.......x..."),
    euclid({
      voice: "openhat",
      pulses: 1,
      steps: 16,
      rotate: 14,
      repeats: 3,
      time: "1/32",
      ramp: -0.6,
    }),
  ],
});
```

| Field                | Range (default)                      | T-1 parameter    | Behaviour                                                                                     |
| -------------------- | ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------- |
| `steps`              | 1..64 (16)                           | Steps            | Length of one pass; the row repeats every pass to the end of the loop.                        |
| `pulses`             | 0..steps (4)                         | Pulses           | Hits spread over the steps by Bjorklund's algorithm.                                          |
| `rotate`             | -64..64 (0)                          | Rotate           | Shifts the pattern later by n steps (negative: earlier), Strudel's direction.                 |
| `division`           | 1/32, 1/16t, 1/16, 1/8t … 1/1 (1/16) | Division         | Length of one step.                                                                           |
| `grid`               | `x` hit, `X` accent, `.` rest        | per-step editing | Explicit steps instead of pulses; its length is the step count.                               |
| `repeats`            | 0..16 (0)                            | Repeats          | Extra hits after each pulse, cut off by the next pulse (T-1 "choke" mode).                    |
| `time`               | a division (= `division`)            | Time             | Spacing of those repeats.                                                                     |
| `pace`               | -1..1 (0)                            | Pace             | > 0 slows the repeats down progressively, < 0 speeds them up.                                 |
| `ramp`               | -1..1 (0)                            | Ramp             | Velocity across the repeats: > 0 builds, < 0 fades.                                           |
| `velocity`           | 0..1 (0.8)                           | Velocity         | Base velocity.                                                                                |
| `accent`, `accents`  | 0..1 (0), 1..pulses (1)              | Accent           | Lifts `E(accents, pulses)` of the pulses (or the `X` steps) towards full velocity.            |
| `gate`, `legato`     | 0.05..4 steps (1), boolean           | Sustain          | Note length in steps; `legato` holds each hit to the next one (Strudel `euclidLegato`).       |
| `probability`,`seed` | 0..1 (1), 0..1e6 (0)                 | Probability      | Drops pulses (and their repeats) by a seeded hash: the same seed always drops the same hits.  |
| `swing`              | -0.5..0.5 step (0)                   | Timing           | Every second step later (> 0) or earlier.                                                     |
| `nudge`              | -0.5..0.5 step (0)                   | Delay            | The whole row later or earlier.                                                               |
| `cycles`             | 1..16 entries                        | Cycles           | Per-pass overrides of `pulses`, `rotate`, `repeats`, `probability`, `velocity`, used in turn. |

Rows regenerate when the loop length or meter changes. Editing a generated lane by hand (play-mode recording, `hit`, the agent's `add_drums`) freezes that row: the row is dropped and its notes stay as plain notes. `euclid <voice> freeze` does the same on purpose, `euclid <voice> off` removes the row and its notes.

Prompt grammar: `euclid kick 4 16`, `euclid hat 7 16 rotate 2`, `euclid hat swing 0.2 prob 0.8 seed 3` (named fields merge into the existing row, `default` resets one), `euclid snare off|freeze`, `grid snare ....X.......x...`. The agent's `set_rhythm` tool takes the same rows and its prompt prefers it for drums.

**Editor.** `/euclid [voice]`, or Rhythm in `/menu`, opens a T-1-style editor on the focused kit or oneshot sampler track: one row per voice with its step grid (`x` hit, `X` accent, `·` rest) and summary (`E(4,16)`). Every change runs one `euclid …` command, so it is one receipt and one undo step, and the edited voice plays once (audition) after it lands. The hits show on the highway like any notes.

| Key                         | Action                                            |
| --------------------------- | ------------------------------------------------- |
| `↑ ↓` / `j k`               | select voice                                      |
| `← →` / `h l` / `- +`       | nudge the selected parameter                      |
| `Tab` / `Shift-Tab` (`] [`) | next / previous parameter                         |
| digits, `.`, `-`, Backspace | type a value, Enter applies                       |
| Enter                       | add a row for a voice without one; keep (looping) |
| Space                       | start or stop the audition loop (staging)         |
| `a` / `c`                   | A/B / solo ↔ in context, while the loop plays     |
| `x` / Delete, `f`           | remove the row and its notes / freeze it to notes |
| Esc                         | cancel typing, revert staged changes, then close  |

## Chords

`core/chords.ts` is one pure, deterministic chord engine shared by the agent tools, the SDK helpers and play mode. Its input model follows the Telepathic Instruments ORC-1 Orchid; the parts Orchid does not document are dawg's own and are marked so.

From Orchid's documentation and reviews:

- Four chord-type buttons, `dim min maj sus`, and four extension buttons, `6 m7 M7 9`. Hold a type and press a root for the chord; extensions add notes on top of a type (or of a Key-mode chord) and any number of them combine (Maj + M7 + C = Cmaj7). Extensions never play alone.
- Key mode: once a key is set, every key plays the chord that fits the key (C major: D plays Dm). Type and extension buttons still work on top for less obvious choices.
- Voicing dial: each click moves the chord's lowest note up an octave, or its highest note down, walking through inversions and up or down the keyboard.
- Bass: an optional engine that plays the chord's root under every chord. Its menu (manual 10.2, "How to use Bass on Orchid") has Chords Only (bass only under chords), Unison (single notes play bass and treble together), Single Notes (single notes play only bass; the treble sounds only for chords) and Solo (the treble is muted, even for chords).
- Performance modes: Strum (and 2-octave), Slop (random timing per note for a humanised feel that varies with every press), Arpeggiator (and 2-octave, tempo-synced; more chord notes make a longer pattern), Pattern (fixed rhythms) and Harp (a sweep across several octaves).
- "Secret chords" (firmware 3.84+, Orchid manual section 14.8): two type buttons held together play extra chords. dim+sus is a power chord (C5), maj+sus augmented (C+), min+sus Cm(add4); min+dim with the 6 button is Cm(b6), maj+dim with 6 is C(b6), and maj+min with m7 is C7♯9. dawg's `COMBINED_TYPES` is this table.
- Orchid has no generator that writes a progression for you. Key mode is its "easy chord progressions" feature: you pick the order, every key is in key.

dawg's own design:

- Secret chords play without their listed extension, since a latched pair is already deliberate; the listed extension is part of the chord and is not stacked again. Other extensions add on top (`Cm(add4,7)`). With three types latched, the first two in `dim min maj sus` order count.
- Key-mode chords are the diatonic triads (sevenths when asked) of `major`, `minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian` and `harmonic-minor`. A key outside the scale plays the chord borrowed from the parallel major or minor when that scale has the note (C major: E♭, A♭, B♭), otherwise a passing diminished seventh.
- Voice leading: a voicing is the chord in root position from C4, rotated by the dial. When there is a previous chord, every rotation within one octave of the dial is scored by movement (each new voice's distance to the nearest old voice, plus the reverse, so common tones are free), kept within C3–G5 where it fits, and the cheapest wins; ties go to the rotation nearest the dial. Spread `open` drops the second voice from the top an octave (drop 2), `wide` also the fourth.
- Bass is the root (or slash bass) in C2–B2, one sustained note per chord. The five bass modes `off`, `chords`, `unison`, `single` and `solo` follow Orchid's menu; under `unison` the agent and SDK use the chord's root and ignore a slash bass, and in play mode a single note's bass is the same pitch class two octaves under the pressed octave.
- Pattern perform mode: Orchid ships fixed rhythm patterns but does not publish them, so dawg's thirteen are its own (`eighths`, `sixteenths`, `offbeat`, `pop`, `charleston`, `bossa`, `skank`, `gallop`, `half-time`, `tresillo`, `oom-pah`, `roll`, `pick`), chosen by name or number 1–13. Each is a list of hits (beat, length, accent, which voices: all, the upper voices, the root an octave down, or chosen chord tones) over one or two bars, repeated over the held length and cut at its end. Accents scale the press velocity.
- Perform modes `block`, `strum-up`, `strum-down` (1/32-beat gap), `arp-up`, `arp-down`, `arp-updown`, `arp-random` (seeded) with a grid-aligned `rate` and 1–4 `octaves`, `harp` (a 1/16-beat upward sweep across the octaves that rings to the end of the chord), and `slop` (Orchid's humanised block chord: each voice lands up to 1/16 beat late, chosen by the press's seed, so repeats differ but a recording replays exactly).
- Progressions (dawg's "auto"): eleven presets (`axis` I–V–vi–IV, `sad-pop` vi–IV–I–V, `fifties` I–vi–IV–V, `ii-v-i`, `turnaround` I–vi–ii–V, `canon`, `aeolian` i–VI–III–VII, `andalusian` i–VII–VI–V, `minor-ii-v`, `dorian-vamp`, `mixolydian-rock` I–♭VII–IV–I) and four styles, `pop`, `jazz`, `modal` and `classical`, that walk a weighted graph of scale-degree transitions (tonic → predominant → dominant → tonic, with plagal and vi–IV moves for pop and the cycle of fifths for jazz) from I with a seeded PRNG. A progression of four or more chords ends on a dominant-function chord (V or vii°; IV or vii in modal) so the loop leads home. The same key, style, length and seed always give the same chords.

Agent. `suggest_progression {key?, chords? | style?, length?, seed?, sevenths?, inversion?, spread?}` (read-only) returns each chord's name, roman numeral, voicing and bass. `write_chords {trackId?, chords, key?, start?, beatsPerChord?, perform?, pattern?, rate?, octaves?, strum?, velocity?, bass?, bassMode?, bassTrackId?, inversion?, spread?}` writes them as one revision. `chords` takes roman numerals in the key (`ii7`, `bVII`, `V/V`) or symbols (`Cm7`, `F/A`). The system prompt tells the agent to use these tools for chord parts, so its chords are diatonic and voice-led rather than hand-stacked.

SDK. `chord("Cm7", start, length, opts)` and `progression("ii7 V7 Imaj7", { key, from, each, perform, pattern, rate, octaves, strum, seed, voicing, spread, part, bass })` expand to notes at evaluation; see [docs/project-format.md](./docs/project-format.md). The vendored SDK stays one import-free file: `core/sdk/v1.ts` carries a generated copy of the engine (`bun core/sdk/sync-chords.ts`, checked by a test).

## Performance and expression

Notes can say how they are played, and tracks how they perform. Every field is optional: a note or track without them sounds exactly as before. Expression is applied at render to copies of the notes, so the score keeps what you wrote.

Per note (the focused track; a target is `all`, the default, `last` (the note added last), `bar 3`, `bars 2-4` or note ids; the reply names the scope and how many notes changed):

| Command                                                     | Does                                                                                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `art staccato\|legato\|accent\|tenuto\|marcato\|ghost\|off` | staccato half length; legato held into the next note with a short overlap; accent +0.2 velocity; tenuto full length +0.05; marcato two thirds +0.3; ghost half length ×0.4 |
| `glide 60ms` with a target                                  | portamento into each note from the previous pitch                                                                                                                          |
| `bend -200 \| scoop \| fall \| doit \| 0:-200 0.25:0`       | a pitch curve over the note in cents (`at` 0..1 of its length), linear between points                                                                                      |
| `vibrato 5.5 30 [0.2]`                                      | rate Hz, depth cents either side, delay s (then a 0.15 s fade-in)                                                                                                          |

Per track:

| Command                                                                       | Does                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `glide 80ms [legato\|mono\|poly]`                                             | `legato` (default): one voice, slides only into a note that overlaps the last, no envelope retrigger; a note with its own glide also slides from a note ending at most a 16th earlier (the TB-303 slide, set on the destination note); `mono` always slides; `poly` slides each voice from the previous chord. Mono and legato glides approach the pitch exponentially (RC), poly linearly; `glide 0` is off |
| `pedal 0-3.5 4-7.5`, `pedal bars`, `pedal down\|half\|up <beat>`, `pedal off` | sustain pedal (CC64; spans in beats from 0, `bars 2-3` in bars from 1): notes released while it is down ring until it lifts; `half` lets them fade; `bars` re-pedals on each downbeat (lift and catch) and replaces the lane                                                                                                                                                                                 |
| `velcurve linear\|soft\|hard\|fixed [v]`                                      | soft (v^0.5) brings quiet notes up, hard (v^2) needs a firm touch, fixed plays every note at `v` (default 0.8)                                                                                                                                                                                                                                                                                               |
| `humanize 8 [5 [10]] [seed n]`                                                | timing ±ms, velocity ±%, length ±%, seeded per note at render (`humanize reseed` for a new take, `off` to remove)                                                                                                                                                                                                                                                                                            |
| `expression`                                                                  | what the focused track does                                                                                                                                                                                                                                                                                                                                                                                  |

Precedence with the synth: a note's settings override the track's synth. A note's `vibrato` replaces the synth's `vib`/`vibmod`, a `bend` replaces the pitch envelope (`penv`), and a gliding note ignores ZzFX `slide`. Render order: articulation, then humanize velocity, then pedal, then glide and mono voicing (on written timing), then humanize timing and length, then the velocity curve.

Menu: **Sound › performance** has glide time (ms) and mode, sustain pedal (off or every bar), velocity curve, humanize timing, velocity and length, and new take; the loop stages them for A/B like any other sound change. Agent: `set_expression` (articulation, glide, bend, vibrato and humanize over note ids or a beat range) and `set_performance` (track glide, pedal, velocity curve and humanize). SDK (1.15.0): `note("C4", 0, 1, 0.8, { art: "staccato", glide: 0.05, bend: [[0, -200], [0.25, 0]], vibrato: { rate: 5.5, depth: 30 }, humanize: { timing: 10 } })`, `expr(notes, { art: "ghost" })` for many notes, and `track({ glide: 0.08, pedal: [[0, "down"], [4, "up"]], velocityCurve: "soft", humanize: { timing: 8, seed: 7 } })`.

## Tunings and scales

Every project plays in 12-tone equal temperament at A4 = 440 Hz until it says otherwise. A song tuning, a track tuning or a note's cents change only the frequencies; notes stay MIDI keys, so editing, chords, play mode and exports work the same. MIDI export carries a tuning with the MIDI Tuning Standard (a single-note tuning SysEx per tuned track, selected with RPN 3), and writes glides, bends, vibrato and note cents as pitch bend (range ±24 semitones) on notes that sound alone on their track; synths without MTS play 12-TET keys. A project without any of these renders byte-identically to 0.4.

Tunings (`core/tuning.ts`). A tuning is one table (`edo: 19`, `ratios: ["9/8", "5/4", …, "2/1"]`, `cents: [231, 474, …, 1200]`, a Scala `scl` file, or a library `name`) plus `ref` (the 12-TET A4 in Hz, default 440, that fixes the root key's pitch), `root` (the key of degree 0) and `map` (`linear` or `nearest`). The last table entry is the period, usually 1200 cents (2/1).

- The library: `12-tet`, `19-edo`, `24-edo`, `31-edo`, `pythagorean`, `just` (5-limit), `7-limit`, `well-tuned-piano` (La Monte Young's 7-limit key map from E♭, after Kyle Gann's published ratios), `pelog` and `slendro` (Kunst's and Surjodiningrat's averages), `nyamaropa` (a Shona mbira after Berliner), `hindustani` (twelve just svaras), `shruti` (the 22 shrutis), maqam and dastgah tables (`rast`, `bayati`, `saba`, `sikah`, `huzam`, `shur`, `homayoun`, `chahargah`, `segah`, `nava`) and raga tables (`yaman`, `bhairav`, `kafi`, `bhairavi`, `todi`, `marwa`, `darbari`, `malkauns` and more, each built from the raga's own svaras over 5-limit defaults). `tuning list` shows each one with a line about it. The gamelan, mbira, maqam and raga tables are marked approximate: every gamelan and every mbira is tuned differently, and maqam and raga intonation varies by tradition and performer.
- Anchoring follows Scala and Surge's tuning library: the root key sounds at its 12-TET frequency under `ref`, and the table counts up from it. So `ref` is the 12-TET A4 that fixes the root, and A4 itself sounds at exactly `ref` only when the root is an A (in `just` from C, A4 is 5/3 above C4, about 436 Hz at ref 440). For an exact reference key and frequency, use a `.kbm` keyboard mapping. The root defaults to the library tuning's own (E♭ for the Well-Tuned Piano), else the song key's tonic in octave 4, else C4.
- Mapping. Twelve-step tables retune the twelve keys. Other sizes default to `linear`, one key per step, as Scala, Surge and Ableton's tuning system do (19-EDO puts the octave 19 keys up). `map: "nearest"` keeps the piano layout instead and plays each key at the nearest table pitch, which suits pentatonic gamelan tables on a normal keyboard.
- Frequencies at or above 20 kHz count as unmapped keys and stay silent, so a coarse table (`edo: 1`) cannot alias at the top of the keyboard.
- Scala. `tuning scl tunings/slendro.scl [kbm tunings/white.kbm]` copies a file from outside the project into `tunings/` and stores the path. The `.scl` parser follows the Scala specification: `!` comments, a description line, the count, then one pitch per line (a period means cents, otherwise a ratio or integer), the 1/1 implicit and the last pitch the period. A `.kbm` keyboard mapping (size, first and last key, middle key, reference key and frequency, octave degree, then the map with `x` for unmapped keys) overrides `ref` and `root`. Bad files are refused with a line number.
- Track tuning overrides the song's field by field: a track with its own table uses it, and `ref`, `root` and `map` fall back to the song's. Drum kits ignore tunings.
- Note cents: `note("E4-14c", 0)`, `add E4-14c at 0` or `cents n3 -14` give one note a static offset of up to ±1200 cents on top of any tuning.

Scales (`core/chords.ts`). The song key string now names any scale: `"D dorian"`, `"A harmonic-minor"`, `"E hijaz"`, `"C yaman"`, `"C messiaen-3"`. The library has the church modes, harmonic and melodic minor, phrygian dominant, major and minor pentatonic, blues and major blues, the maqamat `hijaz`, `bayati`, `rast`, `saba`, `kurd`, `nahawand` and `nikriz`, the dastgahs `shur`, `homayoun`, `chahargah`, `segah` and `nava`, the neutral-third maqamat `sikah` and `huzam`, common Hindustani ragas (`yaman`, `bhairav`, `kafi`, `bhairavi`, `asavari`, `khamaj`, `todi`, `purvi`, `marwa`, `darbari`, `malkauns`, `bhupali`, `durga`) by their thaat or aroha notes, and Messiaen's seven modes of limited transposition. Every existing key string reads as before. Quarter-tone scales (Bayati, Rast, Saba) name their half-flat degrees; setting such a scale suggests the matching library tuning so they sound.

Chords. The chord engine stays twelve-tone: a scale outside the seven diatonic modes uses the nearest diatonic mode for key-mode chords. In a twelve-key tuning chords keep their keys (so in `just` they sound pure); in a linear non-12 tuning such as 19-EDO, the chord tools and play-mode chord phrases move each written pitch to the key that sounds nearest, so a C major triad becomes steps 0, 6 and 11.

Play mode. `i` (or `/play degrees`) toggles scale-degree mapping: the home row `A S D F G H J K L ; '` plays consecutive degrees of the song scale, or every step of a linear non-12 tuning (the nearest step to each scale note when a key is set), and the upper row is off. When a tuning has more steps than the home row (19- or 31-EDO with no key), `Z`/`X` page by eleven degrees instead of a period, so every step is reachable. `/play chromatic` turns it back off. The header shows the scale and tuning.

Highway. A note that sounds more than half a cent away from 12-TET shows a compact cents tag (`+14`, `−32`) after its label when there is room. In a twelve-key table the tag is measured from the note's own lane. In a linear non-12 table (19-EDO, slendro) the lane is only the key, so the tag names the 12-TET pitch it is measured from (`D#−47`, or `C` when it sounds right on it), and lane labels mark the tuning's periods (every 19 keys from the root) instead of every C.

Commands and menu.

| Command                                     | Does                                                   |
| ------------------------------------------- | ------------------------------------------------------ |
| `tuning <name>` · `edo <n>` · `off`         | song tuning (`off` is 12-TET)                          |
| `tuning ratios 9/8 5/4 … 2/1` · `cents …`   | a custom table                                         |
| `tuning scl <file> [kbm <file>]`            | a Scala scale and optional keyboard mapping            |
| `tuning ref <hz>` · `root <note>` · `map …` | reference pitch, root key, `linear` or `nearest`       |
| `tuning track <…>` · `track off`            | the focused track's own tuning; `off` follows the song |
| `tuning list` · `scale list`                | the libraries                                          |
| `scale [<tonic>] <name>`                    | the song key and scale (`scale D hijaz`)               |
| `cents <id> <±c>`                           | detune one note                                        |

The menu has the same in Project › tuning & scale (song tuning, ref, root, map, equal steps, ratios, cents, Scala file, keyboard map, scale and tonic; `/menu tuning` jumps there) and Sound › tuning (the track's, showing inherited song values as `· song`). The Chords tonic row keeps a library scale (`D hijaz` stays hijaz). Agent: `set_tuning {target?, name? | edo? | ratios? | cents? | scl?, kbm?, ref?, root?, map?, off?}` and `set_scale {tonic?, scale}` run the same commands, `add_notes` and `update_notes` take an optional `cents` per note (0 clears it), and the agent brief carries the song and track tunings and a `cents` column when a focused note has one. SDK 1.16.0: `song({ tuning })`, `track({ tuning })` (a name string or an object), and pitch strings with a cents suffix (`note("E4-14c", 0)`, `seq("C4 E4-14c G4+2c")`).

Rendering. Synth and wavetable voices start at the tuned frequency; keyed samplers repitch by the ratio between the tuned and the 12-TET frequency, and one-shot samplers apply note cents only. Live playback, audition and export use the same table, so what you hear is what renders.

## Play mode (computer keyboard)

`Ctrl-P` or `/play` turns the computer keyboard into a piano for the focused track, using the "musical typing" layout GarageBand, Logic, BandLab, FL Studio and Ableton share. `Esc` or `/play off` leaves it and every normal binding is back. Typing `/` starts a slash command without leaving the mode (`/click 40%`, `/play off`).

| Key                     | Does                                                                     |
| ----------------------- | ------------------------------------------------------------------------ |
| `A S D F G H J K L ; '` | white keys C D E F G A B C D E F from the base octave                    |
| `W E T Y U O P`         | black keys C♯ D♯ F♯ G♯ A♯ C♯ D♯ (none on `R` or `I`, like a piano)       |
| `Z` / `X`               | octave down / up (clamped to the score's pitch range)                    |
| `C` / `V`               | velocity down / up in steps of 16 (1–127, shown in the header)           |
| Shift + note            | sustained note: rings until a plain key or `Tab`                         |
| `Tab`                   | sustain pedal latch on/off (off releases every sustained note)           |
| `R`                     | record arm on/off                                                        |
| `Shift-R`               | replace: bars you play over are cleared first (default: overdub)         |
| `M`                     | click on/off                                                             |
| `I`                     | scale-degree keys on/off (see [Tunings and scales](#tunings-and-scales)) |
| `Space`                 | play/stop; with record armed and stopped, counts in, then records        |
| `?`                     | the play-mode keys and current settings (any key closes)                 |
| `/`                     | type a slash command without leaving (`/click 40%`)                      |
| `Esc`                   | leave play mode                                                          |

Recording keeps each note's velocity from `C`/`V`. Sustain is recorded the way Logic's Musical Typing records its `Tab` sustain key: as pedal events (`down` when `Tab` latches or Shift starts holding, `up` when it lets go) on the track, at the playhead and not quantized, while the notes keep the length the key was held. Terminals report key-down only, so `Tab` latches rather than holds. A chord-mode press keeps its held length on its voices instead.

### Chord mode

Play mode has a chord sub-mode modelled on the Orchid's Key mode. It is `auto` by default when the focused track can play chords (pitched synths, piano, soundfonts, keyed samplers; not tracks whose instrument, name or id says bass, kit, drum or perc) in 12-TET without a mono or legato glide, otherwise `manual`, so a track in pelog, just intonation or another non-12 tuning, or a TB-303-style legato line, records single notes. Choosing a mode by hand (`Q`, `/chords`, the menu) sticks for the session.

- `auto`: each note key plays the diatonic chord of the song key on that root (C major: `S` plays Dm, `G` plays G). Keys outside the scale borrow from the parallel major or minor. The strip labels every white and black key with its chord.
- `manual`: note keys play single notes as before; latch a chord type or extension and they play that chord on the pressed root.
- `off`: plain play mode; the chord keys below go back to being unmapped.

Terminals send no key releases, so the Orchid's held left-hand buttons are latches here: press once to latch, again to release, `0` clears them all.

| Key       | Does (chord mode on)                                                            |
| --------- | ------------------------------------------------------------------------------- |
| `Q`       | auto ⇄ manual                                                                   |
| `1 2 3 4` | latch chord type dim / min / maj / sus (two latched make a combined chord)      |
| `5 6 7 8` | latch extension 6 / m7 / M7 / 9 (any number; on top of the type or auto chord)  |
| `0`       | clear every latch                                                               |
| `-` / `=` | voicing dial down / up (-12..12; walks inversions)                              |
| `9`       | next perform mode (block, strum-up, strum-down, arp-up, …, harp, slop, pattern) |
| `B`       | next bass mode: off, chords, unison, single, solo (bass in C2–B2)               |
| `N`       | play the suggested next chord (the `next` chord in the header)                  |

The header gains `AUTO C major · Dm (ii) · next G`: mode, key (`(assumed)` when the score has none and C major is used), the last chord with its numeral, and the suggested next chord. A legend row under the keyboard strip lists the number-row latches (`1 dim  2 min  3 maj  4 sus  5 6  6 m7  7 M7  8 9  0 clear  -= voicing 0  9 block  b bass off  n next  q auto`), with latched ones lit; at 80 columns the row ends where it fits. The full chord state is in the `?` panel, in the header's words: `chords AUTO C major · Dm (ii) · next G · min+m7 · voicing +1 · arp-up · bass chords`. The suggestion comes from the progression engine: the next chord of the chosen preset when the last chord is in it, otherwise a seeded step of the style's transition graph.

Each chord is voice-led from the previous one and sounds through the live voice path. Recording quantizes the press like a note and lays the chord out with the perform mode over its held length (arpeggios at `rate`, `grid` by default; patterns from the press's quantized start), plus the bass note. Under `unison`, `single` and `solo` a single note in manual mode also records its bass (and, for `unison`, the note itself); `solo` records chords as bass only; each bar is still one revision and one undo step.

`/chords` with no argument prints the settings; `/chords auto|manual|off`, `voicing <n>`, `spread close|open|wide`, `bass off|chords|unison|single|solo` (`on` means `chords`), `sevenths on|off`, `perform <mode>`, `pattern <1..13|name>` (also selects the pattern perform mode), `rate grid|1/4|1/8|1/16|1/32`, `octaves 1..4`, `preset <name>|none`, `style pop|jazz|modal|classical`. `key <tonic> <mode>` (`key A minor`, `key F# dorian`, `key none`) sets the song key as one score edit. The same settings and the key are in `/menu` under Chords.

The base octave follows the instrument: C3 (MIDI 48) by default, C2 for bass instruments or tracks named bass, C4 for saw/square/triangle/pluck leads. Kits start at C2, so `A` is the GM kick, `S` the snare, `T` the closed hat. On a one-shot sampler track the keys walk the voices in name order from slot 36 (`A` the first voice, `W` the second, chromatically), and the strip shows voice names; a keyed sampler starts at the C below its lowest root and repitches from it.

The header reads `PLAY  C3–F4  ● REC` with a beat flash and ends in `? keys · esc leave`; velocity, grid, click and count-in are in the `?` panel, and a key that changes one (`C`, `V`, `M`) says so in the header's status for a moment. The row under it is the keyboard with sounding keys lit. Both repaint in place; nothing scrolls per note.

Notes sound through the track's own instrument, effects and volume, rendered by the same per-instrument voice code as the loop, and mix into the stream about 60 ms ahead of now (play mode lowers the queue lead from 200 ms and restores it on exit). That works over silence and over the playing loop. A muted or unsoloed track still sounds while you play it. With audio backend `none` the keys still record.

Terminals send key presses and auto-repeats, never key releases, so held notes are synthesized. A press sounds for one grid step; holding the key keeps it sounding while the OS auto-repeats it (after its repeat delay, usually 250–700 ms), and it ends about 120 ms after the last repeat. Hold notes shorter than the repeat delay come out one grid step long. Use Shift or the `Tab` latch for long notes.

Recording: with record armed and the transport running, each note is quantized to the grid (`/grid 1/16` by default; `1/4 1/8 1/8T 1/16 1/16T 1/32`), wrapped into the loop, and appended to the focused track as `addNote` operations when the playhead leaves the bar, so each recorded bar is one revision: one `Ctrl-Z` undoes a bar, other windows and the project files see it like any edit. Stopping commits the rest. The same pitch on the same step twice is one note. Replace removes the bar's earlier notes in the same revision. No agent and no network are involved.

## Click track

`/click on|off|<volume>` (`/click 40%`, `/click 0.4`) or `M` in play mode. An accented downbeat and lighter beats at the transport tempo and the score's meter, mixed as a separate monitoring bus. It is never part of a loop render, a stem, `dawg render`, or `/export`; tests compare those byte for byte with the click on. `/count-in 0|1|2` sets how many bars of click play before recording starts (default 1); the header counts down and flashes the beat, so it also works with backend `none`.

## Tempo and meter

Ticks stay score time; an optional song `time` field turns them into seconds (`core/tempo.ts`). A beat is a quarter note and BPM counts quarter notes, as in Standard MIDI Files, so a 7/8 bar lasts 3.5 beats. Without `time` and without track `time` everything is the 0.4 arithmetic and renders byte-identically.

```text
tempo 90 at bar 9            step change on bar 9's downbeat (beats count from 0, bars from 1)
tempo 140 at 64 ramp         glide from the previous tempo into 140 at beat 64 (linear, equal BPM per beat)
tempo 70 at bar 17 exp       exponential glide: equal ratio per beat, even to the ear
tempo remove bar 9 | tempo clear | tempo map
rit 4 bars to 80             ritardando over the last 4 bars; rit/accel default to 75% / 133% over the last 2 bars
a tempo [at bar <n>]         step back to the tempo before the last rit/accel (default: the bar after it ends)
tempo primo [at bar <n>]     step back to the start tempo
accel 8 bars to 174 at bar 9 accelerando from bar 9; `beats` instead of `bars`, `exp` for an exponential curve
fermata at 31 2              hold beat 31 for 2 extra beats; fermata [at <beat>|[at] bar <n>|[at] end] [<extra beats>], default 2
meter 7/8 at bar 5           meter change on a bar line, lasting until the next one; meter 7/8 alone sets the whole song
meter remove bar 5 | meter clear
track rate 3/2               polytempo: the focused track plays at 1.5× the song tempo (0.125..8 or a/b)
track phase 0.5              start the track half a beat later
track cycle 3                polymeter: loop the track's first 3 beats against the song's bars
track phasing 3 [over 48]    continuous drift: a 3-beat cycle gains one cycle every 48 beats, then realigns (needs a loop of whole spans)
track phasing 3 hold 8       stepped, as in Piano Phase: hold in step 8 cycles, move a sixteenth ahead over 2 (drift 2, shift 0.25)
track time off               follow the song again
```

- **Tempo events** (`time.tempo: [{tick, bpm, ramp?}]`) follow `tempoBpm`, which stays the start tempo. An event without `ramp` is a step; `ramp: "linear"` or `"exp"` glides from the previous tempo into the event. Ramps are defined over score position (beats), as Logic's and Cubase's tempo curves and MuseScore's gradual tempo changes are, and the renderer integrates them in closed form, so a ramp lands on the same sample however it is rendered.
- **rit / accel** write a pin at the start (the tempo in effect there) and a ramp to the target. MuseScore's defaults are used when no target is given: ritardando to 75%, accelerando to 133%. A rit refuses a faster target and an accel a slower one. `a tempo` and `tempo primo` are plain steps back.
- **Fermatas** (`time.fermatas: [{tick, beats}]`) lengthen the beat that starts at `tick` to `1 + beats` times its length (the meter's felt beat: a dotted quarter in 6/8 or 12/8, a quarter otherwise): everything inside that beat slows evenly and everything later moves back. WAV and MIDI export time it the same way (MIDI writes a slower tempo over the beat), so a held beat may last at most 16.777 s, the slowest tempo a MIDI file can write; a longer hold is refused with a message.
- **Meter changes** (`time.meter: [{bar, beatsPerBar, beatUnit}]`, `bar` 0-based in the file) take effect on bar lines only. The bar lasts `beatsPerBar × 4 / beatUnit` beats; `beatsPerBar` on the song stays the default meter. The click accents each bar's downbeat and clicks the meter's beat unit (dotted in compound meters such as 6/8), the count-in uses the meter and tempo at the punch-in bar, the highway draws bar lines and numbers from the meter map, and play-mode replace erases the bars the meter map says.
- **Track time** (`track.time: {rate, phase, cycle, steps?}`, phase, cycle and shift in ticks in the file) places a track's notes on the song timeline: the first `cycle` ticks repeat every `cycle / rate` song ticks, shifted `phase` song ticks later, restarting with every song loop. Two identical tracks with one on `track phasing 4` drift apart a little each cycle and line up again after `over` beats (default the loop), the continuous tape phasing of Reich's _It's Gonna Rain_ and _Come Out_; `over` and the cycle must divide the loop, and the prompt names the bars it needs otherwise. `track phasing 3 hold 8` stores `steps: {shift, hold, drift}` instead of a rate: the track holds in step for `hold` cycles, then moves `shift` ahead over `drift` cycles, and repeats, the shift-and-lock process of _Piano Phase_ and _Drumming_. Automation stays in song time.
- **Everywhere**: the offline renderer, the live engine and audition loop, the transport clock (beat ⇄ wall time, shared by every window through dawgd), click and count-in, recording quantization and the highway use the same map. `/export song.mid` and `dawg render song.mid` write a format-1 Standard MIDI File: track 0 carries the time-signature (FF 58) and tempo (FF 51) meta events, ramps are written as tempo steps every sixteenth whose BPM is the exact average over the step, so each step boundary lands on the same second as the WAV.

The menu has the same controls under **Project › Tempo & meter** (`/menu tempo`): the tempo map (add a change, a ramp, a rit or accel, a tempo, tempo primo, a fermata), meter changes, and the focused track's rate, phase, cycle, phasing and stepped phasing. The agent's `set_time` tool takes the same actions, and the SDK has `tempo`, `ramp`, `rit`, `accel`, `aTempo`, `tempoPrimo`, `fermata`, `meter`, `phasing` and `stepPhasing` (see **Project files and SDK**).

## Drum patterns and kits

**Patterns.** dawg ships a library of 31 starting grooves, written for dawg from the defining placements of each style (no transcriptions). A pattern is a set of rhythm rows, one per voice, so after applying it every part is still a few Euclidean or grid parameters you can change in `/euclid`, with the prompt grammar, or in `track.ts`.

| Command                                | Does                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/pattern`                             | picker of every pattern; moving the cursor plays one bar of it (silent while the loop plays), typing filters, Enter applies                          |
| `/pattern <name>`                      | replace the focused drum track's notes and rows with the pattern; the tempo moves to the pattern's tempo only when it is outside the pattern's range |
| `/pattern <name> keep-tempo` / `tempo` | never / always move the tempo                                                                                                                        |
| `/pattern list`                        | the library as text: name, tempo range, tags, voices                                                                                                 |

Applying to a missing track creates a kit track; an empty melodic track becomes a kit track; a melodic track with notes is refused. Voices the track lacks (a sampler kit without a rim, say) are skipped and named in the receipt. Every apply is one revision and one undo step. In `track.ts`, `pattern("boom-bap")` returns the rows: `rhythm: pattern("boom-bap")`, or `[...pattern("house"), euclid("rim", 5, 16)]` to add one.

Patterns: `house`, `disco`, `techno`, `minimal`, `electro`, `breakbeat`, `amen-style`, `dnb`, `halftime`, `boom-bap`, `lofi`, `trap`, `drill`, `reggaeton`, `dancehall`, `one-drop`, `afrobeat`, `afrobeats`, `bembe`, `tresillo`, `son-clave`, `bossa-nova`, `samba`, `cumbia`, `garage`, `jersey-club`, `footwork`, `rock`, `funk`, `shuffle`, `euclid-poly`. Sounds → Drum patterns in `/menu` lists them too.

**Kits.** A `kit` track plays the built-in drum synth. `kit: "<name>"` on the track (`/kit <name>`, or `set_drum_kit` for the agent) chooses one of six synthesized kits, all offline and deterministic; a track without `kit` sounds exactly as before.

| Kit        | Sound                                                        |
| ---------- | ------------------------------------------------------------ |
| `default`  | the original voices                                          |
| `syn808`   | long sub boom, snappy snare, metallic hats                   |
| `syn909`   | punchy clicky kick, bright noisy snare                       |
| `acoustic` | beater kick, wire snare, darker cymbals                      |
| `lofi`     | soft round kick, crushed and dark (alias `dusty`)            |
| `electro`  | tight short kick, clicky rim, ticking hats (alias `minimal`) |
| `trap`     | distorted long 808, crisp hats, high snare                   |

Sample kits from packs (`/kit 909` and the rest, see **Sample packs**) sit in the same picker after the synth kits. `/kit syn909` on a sampler kit turns it back into a synth kit track, moving hits and rows to the drum voices of the same name. The agent has `list_drum_patterns`, `apply_drum_pattern {name, trackId?, tempo: auto|keep|set}` and `set_drum_kit {kit, trackId?}`, and its prompt starts genre grooves from a pattern.

## Arrange (sections and form)

A song can name its parts. A **section** is a named bar range (`intro`, `verse`, `pre`, `chorus`, `build`, `drop`, `breakdown`, `bridge`, `outro`, or any name up to 32 characters) with optional per-section track mutes and variations. The **form** is an ordered list of sections with repeats (`verse verse chorus verse`, `intro verse chorus*2 outro`); a repeated pass plays identically, so `section dup chorus as last chorus` and a variation on the copy make a different last chorus that playback and export follow. A song without sections or a form plays and renders exactly as before, byte for byte.

Sections are markers over the timeline, like the arranger track in Studio One or Cubase and Logic's arranger: marking one never moves notes, while `dup`, `move` and `delete` take the section's bars with them and ripple the bars after it. Sections may overlap, so `chorus` and `chorus 2` can share bars and differ only by mutes and variations. Bars are numbered from 1 at the prompt, as a DAW ruler shows them, and from 0 in the score and the SDK.

| Command                                                                     | Does                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `section`                                                                   | list sections, the form and the looped section                                                                                                                                                                                                                                                                                                                              |
| `section [mark] chorus 9-16`                                                | mark bars 9–16 as `chorus` (re-marks an existing one)                                                                                                                                                                                                                                                                                                                       |
| `section add [<name>] [<n> bars]`                                           | a new section after the last one, growing the song                                                                                                                                                                                                                                                                                                                          |
| `section dup <name> [as <new>]`                                             | copy the section and its bars right after it                                                                                                                                                                                                                                                                                                                                |
| `section move <name> to <bar>` / `left` / `right` / `before <x>`            | move it with its bars                                                                                                                                                                                                                                                                                                                                                       |
| `section rename <name> to <new>`                                            | rename it (the form and the loop follow)                                                                                                                                                                                                                                                                                                                                    |
| `section delete <name>` / `section unmark <name>`                           | remove it with its bars (ripple), or only the marker                                                                                                                                                                                                                                                                                                                        |
| `section mute <name> [<track>…]` / `unmute`                                 | silence tracks in that section (the focused track by default)                                                                                                                                                                                                                                                                                                               |
| `section vary <name> [<track>] +12 [gain 0.8]` / `off`                      | transpose (semitones) or scale velocities of a track in that section                                                                                                                                                                                                                                                                                                        |
| `section reset <name>`                                                      | clear its mutes and variations                                                                                                                                                                                                                                                                                                                                              |
| `section loop <name>` / `section loop off`                                  | loop that section in playback (the per-song cycle, saved with the project)                                                                                                                                                                                                                                                                                                  |
| `section jump <name>`                                                       | move the playhead to it                                                                                                                                                                                                                                                                                                                                                     |
| `form intro verse*2 chorus outro` / `form off` / `form bake`                | set the form; clear it; or write it out as a linear score (one undo step)                                                                                                                                                                                                                                                                                                   |
| `build into <section> [<n> bars]`                                           | a build on the n bars (default 4) before the section, landing on its downbeat                                                                                                                                                                                                                                                                                               |
| `build [<section> \| <a>-<b>] [<n> bars] [riser] [roll] [sweep] [uplifter]` | a build over the section (its last n bars with `<n> bars`) or the bars; default the song's last four bars; all four layers by default                                                                                                                                                                                                                                       |
| `drop [<section> \| at <bar>] [cut <beats>] [no impact]`                    | a pre-drop cut (1 beat of silence by default, up to two bars) and an impact on the downbeat; bare `drop` lands on the section named `drop` or `chorus`, else on the bar after the last build (adding that bar when the build ends the song); with neither it asks for `drop chorus` or `drop at 17`. A cut that clips a build's uplifter retunes its rise to end at the cut |
| `fill [<section> \| at <bar>] [toms\|roll\|kick] [<n> beats] [no crash]`    | a drum fill on the beats before the section (1 by default, ½ beat up to two bars), or at every section boundary                                                                                                                                                                                                                                                             |

Playback follows the form; with a section looped it loops just that section, with its mutes and variations, and the highway, play mode and auditions stay inside it (an audition region is clipped to the looped section). Export (`dawg render`, the agent's preview) always plays the whole form and ignores the section loop; `dawg render out.wav --section chorus` renders one section. Every WAV covers the whole song (or section) plus its tail; a long song renders in windows and is capped at 15 minutes, and a held note that crosses a window seam is crossfaded so long drones stay smooth. Exports mark the form: WAV renders carry a `cue ` point and `LIST adtl` label at each section start, and MIDI exports an FF 06 marker. Sections count bars in one meter: a compound meter held from bar 1 (`meter 6/8`, `song({ meter: [12, 8] })`) works, while meter changes later in the song and sections exclude each other.

Generators write ordinary notes, tracks and automation, so everything they make can be edited or undone (one step per command):

- **riser**: a `riser` track of filtered white noise whose cutoff and volume ramp up over the range.
- **roll**: an accelerating snare roll on the kit track (quarters, 8ths, 16ths, then 32nds, crescendo), on a `roll` kit track when the song has none.
- **sweep**: unfiltered or high-pass pitched tracks playing in the range get a high-pass sweep up to 1.2 kHz, and low-pass tracks open from a tenth of their cutoff to it; both sweep on an octave (log-frequency) curve and snap back on the next downbeat. The riser's cutoff rises the same way.
- **uplifter**: a `uplifter` supersaw with a rising pitch envelope, tempo-synced to land on the bar after the range (at most 10 s); builds of another length get their own `uplifter-<bars>` track so each lands on time.
- **cut** and **impact**: notes starting in the last beats before the drop are removed and held notes are shortened; an `impact` sine with a pitch drop and noise hits the downbeat.
- **fill**: 16ths replace the groove in the fill's beats: `toms` starts on the snare and steps down high, mid and low toms (GM 50, 47, 45; the built-in kit folds them onto its one tom), `roll` is snare and `kick` kick and snare. The crash on the next downbeat is an open hat plus a kick, since the built-in kit has no cymbal.

Section mutes and variations govern every bar of their section: a note held from an earlier section stops at the bar where a section that mutes its track begins, so a song sounds the same played straight through and through the form. Generators place their cut and crash by bar order in the score; with a form that reorders sections, run them on the bars that precede the target in the form (`build 13-16`, `fill at 17`).

The arrangement strip is one row under the header that shows the sections over the timeline (`▏verse   ▏chorus`), the looped section reversed, the section under the playhead bold, and the playhead as `▼`. It appears only when the song has sections. The menu's **Arrange** section (`/menu arrange`) lists every section; each opens loop, jump here, a mute toggle for every track, transpose and gain, build (into it, over it, or custom length and layers), drop (cut length and impact), fill (style, beats and crash), duplicate, duplicate as, move to, move left and right, rename, clear mutes and variations, unmark and delete. Agent tools: `list_sections`, `edit_section` (mark, add, duplicate, move, rename, delete, unmark, mute, unmute, vary, reset, loop, unloop), `set_form` and `add_transition` (build into or over a section, drop, fill). In `song.ts`: `song({ sections: [{ name: "verse", startBar: 0, bars: 8 }, …], form: "intro verse*2 chorus", loopSection: "chorus" })` (SDK 1.18.0).

## Menus

`/menu` or `Ctrl-K` (on an empty prompt, in play mode too) opens the edit menu, drawn with the same overlay as the model picker. Every edit the agent can make is reachable from it with keys alone. Each row shows a plain label and the current value with its unit (s, Hz, oct, st, dB, BPM, bars); the line under the list describes the focused row and shows, dimmed, the prompt command the row runs, so the menu teaches the commands. `/menu <section>` opens a section directly (`/menu effects`, `/menu arrange`); the old names `parameters`, `sounds`, `track`, `automation` and `transport` still work.

| Section          | Rows (most used first)                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sound            | instrument, preset; a synth's attack, decay, sustain, release, filter cutoff/res/env, detune, vibrato, FM amount, then **advanced** with every synth parameter; a wavetable track's table and wavetable parameters; a sampler's mode and voices; **performance** (glide, pedal, velocity curve, humanize); **browse sounds** (instruments, wavetables, packs) |
| Effects          | the core effects (filter, auto filter, distortion, tremolo, compressor, chorus, delay, reverb) with presets and simple parameters, **more effects** (dj filter, vowel, bitcrush, phaser, leslie, post gain, orbit, duck), and **advanced** per effect (see Effects)                                                                                           |
| Rhythm           | the euclid editor (`/euclid`), drum patterns (`/pattern`), drum kits (`/kit`, synth then samples)                                                                                                                                                                                                                                                             |
| Chords           | play-mode chord mode, key tonic and mode, voicing, spread, bass, sevenths, perform, pattern, arp rate, arp octaves, progression, style                                                                                                                                                                                                                        |
| Mix & automation | the focused track's name, mute, solo, volume, pan; **all tracks** (choosing one focuses it); **automation**: each `AUTOMATION_LANES` lane with its points as `beat N  value` rows, add points, ramp, clear lane; **master**: target, eq, glue, tape, width, limiter                                                                                           |
| Project          | play, tempo, beats per bar, loop length, grid, click, count-in bars                                                                                                                                                                                                                                                                                           |
| Arrange          | every section (loop, jump, mute, transpose, gain, build, drop, fill, duplicate, move, rename, unmark, delete), mark bars, add section, form, loop off (see Arrange)                                                                                                                                                                                           |

Every list, picker and editor uses the same keys (see **Keys** below). In the menu:

| Key                         | Does                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| `↑` `↓` / `k` `j`           | move                                                                      |
| `Enter` / `→` / `l`         | open a section, pick from a list, or open a number's fader drawer         |
| `←` `→` / `h` `l` / `-` `+` | adjust a value by its step (cutoff moves 25%) or cycle a choice           |
| `Space`                     | toggle on/off; elsewhere, hear the focused track (see Previewing changes) |
| digits                      | type a value; `Enter` stages it in the fader drawer, `Esc` cancels        |
| `/`                         | filter the current list by name, value or command                         |
| `x` / `Delete`              | reset the focused value to its default; on an automation point, remove it |
| `Esc` / `←` / `h`           | clear the filter, then back one level, then close                         |
| `?`                         | the keys for this screen                                                  |

Automation rows take `beat:value` pairs (`2:800` or `0:200 4:8000`); a ramp is two pairs, start and end, and the renderer interpolates between points. Turning an effect's first field up switches it on with defaults. Each change runs the command it shows through the normal prompt path, so it is one `ScoreOperation`, one receipt, one undo step, and it syncs to other windows and the project files.

## Fader drawer

Editing a number opens a fader drawer: a panel docked directly above the prompt, over the bottom of the piano roll, which stays visible above it. It opens from `Enter` (or a second click) on a number row in the menu, or from a bare parameter at the prompt: `volume`, `pan`, `fx filter` (every filter param, focused on the first number) or `fx reverb mix` (focused on mix). The drawer stacks every param of that device (all of the filter's, or the Mix screen's), so one drawer covers a device.

```text
╭─ menu › Effects › Filter ─────────── loop off · B staged 1 · ● staged  [keep] [revert]─╮
│   type        lpf │ hpf │ bpf                                                         │
│                                                                                        │
│ › cutoff     1200 Hz ← 800 Hz                                         20 Hz … 20000 Hz │
│   [−] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┃━━━●───────────────────────────────── [+] │
╰──────── ←→ adjust · ⇧←→ coarse · [ ] fine · ↑↓ param · 0-9 type · d default · esc revert ─╯
```

Each field shows its name, current value with unit, the committed value while a change is staged (`1200 Hz ← 800 Hz`), its range, and a bar with `[−]` `[+]` buttons; the bar marks the committed position with `┃`. Wide positive ranges (cutoff, delay time) map on a log scale. Choice params (filter type, presets, on/off) are segmented selectors in the same drawer. Ranges, steps, units and formatting come from the menu row, which takes them from `core/params.ts`, the effect specs and the automation lanes.

Every change is staged on the audition loop (see **Previewing changes**), filed under its field so repeated nudges replace one staged edit; the piano roll and the loop, when it plays, follow at once. `Enter` keeps everything staged as one revision and one undo step; `Esc` reverts. A setting the loop cannot stage (tempo, loop length) applies directly.

| Key                         | In the drawer                                         |
| --------------------------- | ----------------------------------------------------- |
| `←` `→` / `-` `+` / `h` `l` | step by the param's step                              |
| `Shift`-`←` `→` / `{` `}`   | coarse step (five steps)                              |
| `[` `]` / `Alt`-`←` `→`     | fine step (a tenth of a step)                         |
| `PgUp` `PgDn`               | big step (twenty)                                     |
| `Home` `End`                | minimum / maximum                                     |
| `1`-`9` `.`                 | type an exact value; `Enter` sets it, `Esc` cancels   |
| `0` / `d`                   | back to the default                                   |
| `↑` `↓` / `Tab` `Shift-Tab` | previous / next param of this device                  |
| `Enter`                     | keep every staged change (one undo step); none: close |
| `Esc`                       | revert staged changes and close                       |
| `Space` `a` `c`             | audition loop · A/B · solo ↔ in context               |
| `?`                         | these keys                                            |

On a choice, `←` `→` move between options and `1`-`9` pick one by number. Sizes: two rows per field (value line, then bar) while the drawer takes at most half the piano roll; one row per field when shorter, as a window that follows the focused field; and at the 8-row terminal minimum a single borderless row with the focused field. The piano roll always keeps at least 40% of its rows above the drawer (at least three).

## Mouse

dawg turns on SGR mouse reporting (modes 1000, 1002 and 1006) and turns it off again on exit, on `SIGTERM`/`SIGHUP`, on a crash, and around external editors. `--no-mouse` or `DAWG_MOUSE=0` (and `TERM=dumb`) leave it off, so the terminal's own selection and scrollback work; a terminal without mouse support ignores the modes and every key still works. Legacy X10 reports are swallowed rather than typed into the prompt.

| Where               | Click / wheel                                                        |
| ------------------- | -------------------------------------------------------------------- |
| fader `[−]` `[+]`   | step (shift-click: coarse)                                           |
| fader bar           | set the value at that point; drag to slide it (past the ends clamps) |
| fader option        | choose it                                                            |
| fader name          | focus that field                                                     |
| `[keep]` `[revert]` | the same as `Enter` / `Esc`                                          |
| wheel on a fader    | step it (up raises; shift: coarse)                                   |
| list / menu row     | select it; a click on the selected row opens it (`Enter`)            |
| wheel on a list     | move through it                                                      |
| header `▶/⏸ BPM`    | play / pause                                                         |
| header track name   | the track list (`/tracks`); click a track to focus it                |
| header model        | the model picker                                                     |

Hit-testing uses the same paint pass that draws the frame: each painter records its click regions into the frame's `HitMap` (`tui/hits.ts`), so targets never drift from what is on screen. The piano roll does not place notes on click (a note needs pitch, length and velocity that a click does not carry); clicks there are ignored.

## Previewing changes

Hear a sound change before you keep it. In the edit menu (every section: Sound, Effects, Rhythm, Chords, Mix), `Space` starts a short loop of the focused track; `Space` again stops it. The song pauses while the loop plays, so only one thing sounds at a time.

The loop is the track's own notes over its loop region when that is four bars or shorter, otherwise the two bars under the playhead (or the track's first two bars with notes, if those are empty). A track with no notes plays a short phrase by role: a chord for pads and keys, a riff for bass and leads, a groove for kits and drums, and one held note for wavetables so position and envelope changes are audible. It plays solo by default; `c` switches to the whole mix with the track in it.

While the loop plays, each change you make is **staged**, not committed. The loop re-renders only the changed track through the normal renderer and stem cache, in the render worker, and swaps it in within about 100 ms (a reverb mix change re-mixes the cached tail and is heard in about 65 ms). Every swap, here and in the song player, crossfades old to new over 20 ms at the same beat, so changes never click; renders and exports never pass through the crossfade. Held keys are coalesced so only the latest value renders. The menu title shows `●` and `B staged N`, and each changed row shows the staged value beside the committed one (`mix  0.5 ← 0.3`).

| Key     | While auditioning                                            |
| ------- | ------------------------------------------------------------ |
| `Space` | start or stop the loop of the focused track                  |
| `c`     | solo ↔ in context (the whole mix with the track)             |
| `←` `→` | change the focused value; staged and heard at once           |
| `a`     | A/B: flip between the committed sound (A) and the staged (B) |
| `Enter` | keep every staged change as one revision and one undo step   |
| `Esc`   | revert staged changes (the score is untouched); again: back  |
| `?`     | the keys for this screen                                     |

Kept changes are one `ScoreOperation` (`preview.commit`, listing the commands), so `Ctrl-Z` takes them all back at once, and they sync to other windows and the project files like any edit. If the score changes underneath (another window, the agent, an undo), the staged commands are re-applied on top of the new score; any that no longer apply are dropped, with a notice. Leaving the menu reverts anything staged. With the loop off, the menu behaves as before: each change is committed right away.

**The rhythm editor and the chord settings stage too.** `/euclid` and the chord settings (the menu's Chords section, `/menu chords`) use the same loop and keys. In `/euclid`, `Space` loops the drum track; pulses, steps, rotate, typed values, a new row, `off` and `freeze` are staged, the title shows `●` and `B staged N`, and a changed lane shows `E(5,16) ← E(4,16)`. Chord settings are window settings rather than score edits, so while the Chords section is open the loop plays the focused track's chord phrase (two bars of the song key's progression, voiced and performed by the current settings: inversion, spread, bass, sevenths, block/strum/arp, pattern); a staged setting changes the B phrase, and `a` flips back to the committed settings. `Enter` keeps every staged change as one undo step: rhythm edits as one `preview.commit` revision, and chord settings applied at once (a key change, the only one stored in the score, as one revision). `Esc` reverts with nothing written. With the loop off, both screens commit each change at once, as before.

**Lists audition on hover.** With the loop on, moving the cursor through a list plays the highlighted item on the loop: the wavetable list (built-in, pack and project tables), instruments, drum kits and patterns, and every choice list (filter type, warp mode, presets). It is the browser-preview model of Ableton and Bitwig, applied to the loop you are already hearing. Each move replaces the previous hover, so the staged count stays at one, and fast moves skip straight to the latest item. A pack item that has to be fetched shows `fetching…` in the title; the cursor keeps moving and the item plays once it arrives. `Enter` chooses the item (it stays staged until you keep), `Esc` or `←` leaves the list and drops the hover. The `/kit` and `/pattern` pickers work the same way: `Space` starts the loop, moving hears each kit or groove, `Enter` keeps it, `Esc` cancels.

| Key in a list | While auditioning                                   |
| ------------- | --------------------------------------------------- |
| `↑` `↓`       | move and hear the highlighted item on the loop      |
| `Enter`       | choose it (menu) or keep it (picker), one undo step |
| `Esc` / `←`   | leave the list; the hover is dropped                |
| `a` / `c`     | A/B against the committed sound / solo ↔ in context |

**Try a prompt command.** `/try <sound command>` stages one command on the loop instead of committing it: `/try fx reverb mix 0.6`, `/try synth cutoff 800`, `/try wt pwm`. A small panel offers keep or revert; `a` flips A/B, `Enter` on keep commits it as one undo step, `Esc` drops it. Only sound commands can be tried (fx, synth, wt, kit, pattern, pack use, volume, pan and similar).

**What you see.** While the loop plays, the menu title adds a level meter of the looping track or mix: RMS as an eight-cell bar over -48..0 dBFS, the peak in dB, and `!` in the last cell when the loop clips (`♪ solo · B staged 2 · 64 ms · █████··· -9 dB`; the `ms` is the last key-to-swap time). A focused cutoff row draws its low- or high-pass curve on a log axis, an attack/decay/sustain/release row draws the envelope with the other stages, and the wavetable position row marks its place in the table:

```text
│ cutoff (lpf/hpf) or centre (bpf) frequency  ▇▇▇▇▇▇▇▇▇▇▇▅▂▁▁▁  › fx filt… │
```

**The agent can listen too.** The `preview_sound {trackId?, changes?, bars?, context?, play?}` tool renders the same loop score for a track, or for candidate sound tool calls (`changes: [{tool: "set_wavetable", args: {...}}]`, any of `set_fx`, `set_synth`, `set_wavetable`, `set_instrument`, `set_sample`, `set_effects`, `set_mix`, `set_automation`, `set_drum_kit`, `use_sound`) applied to a copy of the score. Nothing is committed. It returns RMS and peak dBFS, the spectral centroid and a one-line description for the current and the candidate sound, plus a comparison (`3.0 dB louder, brighter (×2.00 centroid)`). When the window is quiet (no song or audition loop playing) it plays the candidate once, so the agent can say how it sounds before committing with the normal tools. `/try agent off` keeps agent previews silent (numbers only), `/try agent on` turns them back on; `DAWG_AGENT_PREVIEW=off` starts with them off.

The preview renders through the same path as the song, so filters, automation, shared orbit buses, impulse responses and ZzFX voices sound the same as those bars of the full mix. With no audio device (tests, CI, SSH) the loop does nothing audible and everything else works.

## Keys

One grammar for every picker (`/model`, `/pattern`, `/kit`, `/resume`, the wavetable and pack lists), the menu, the `/euclid` editor and the text panels (`/help`, `/tracks`, the transcript):

| Key                         | Does                                                           |
| --------------------------- | -------------------------------------------------------------- |
| `↑` `↓` / `j` `k`           | move (scroll in a text panel); PgUp/PgDn/Home/End page         |
| `←` `→` / `h` `l` / `-` `+` | adjust the focused value                                       |
| `Enter`                     | open or confirm                                                |
| `Space`                     | audition or toggle                                             |
| `/`                         | filter; typing then narrows the list                           |
| `Esc`                       | back one level: clears the filter or a typed value first       |
| `?`                         | the keys for the current screen, drawn over it; any key closes |
| digits                      | type a value, only where a value is focused                    |

The fader drawer adds coarse, fine and big steps, Home/End and `0`/`d` default (see **Fader drawer**); clicks and the wheel mirror these keys (see **Mouse**).

Every screen ends in a one-line footer of its keys that fits 80 columns (parts drop from the middle when narrower; `esc` and `? keys` stay). `?` on an empty prompt lists the prompt keys and the three ways in. Play mode is the one exception: its letters and number row are piano keys and chord latches (the GarageBand "Musical Typing" convention); its `?` panel says so.

## Release

Bump `version` in `package.json` and add its section to `CHANGELOG.md` in a pull request, then merge it. When Check passes on `main`, the annotated `v<version>` tag, the immutable GitHub Release (tarball, `SHA256SUMS` and a provenance attestation) and the npm publish of `@hraness/dawg` follow automatically. See [docs/publishing.md](./docs/publishing.md).
