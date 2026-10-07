# dawg

dawg is a local-first terminal music workstation with a Pi-like agent loop. Each terminal window can focus on one track while a shared local session keeps the score, transport, and agent operations in sync. It is designed for `dawg` to feel like a coding agent session where the artifact is a loop you can hear and edit.

The first steel thread includes a typed `track.loop/v1` score, an append-only local session with a cross-window writer lock, a terminal piano-roll projection, a multiline prompt, a bounded streaming tool-calling agent on the Vercel AI Gateway, and a local PCM synthesizer. Provider and audio adapters remain behind explicit ports so the TUI can still be exercised without credentials or a sound device.

## Run

```sh
bun install
bun run dawg
```

Run `dawg` from any directory. It creates `.dawg/session` on first use and reuses that session in later terminal windows. Use `dawg --new` for a separate composition, `dawg --session <name|id>` to attach explicitly (an unknown value is `no session named "…" · dawg sessions`, never a new session), and `dawg --track bass` to focus a named track. `dawg --version` prints the version; unknown subcommands and options are rejected with usage before `.dawg/` exists, and the launch that creates `.dawg/` says `created .dawg/ · add it to .gitignore` in the strip. Every window connects to `dawgd`, a per-session daemon the first window starts in the background. It is the single writer: windows send operations with a base revision and an idempotency key, duplicate keys are no-ops, a stale full composition receives a typed rebase diagnostic, and a stale `operations` intent (what the agent sends) is replayed on the current score when nothing it touches changed since its base (the notes it updates or removes, the tracks it rewrites or clears, tempo and length, and ids it creates; at most 64 revisions back, with the base recovered by rewinding the event log); anything else still gets the rebase diagnostic. Every event stores a compact reverse delta (`rewind`) rather than a copy of the previous score, so a session record grows by about the size of each edit; when it nears its 4 MiB cap the oldest rewinds are compacted away and only that older history becomes unreachable. Rebased events record `rebasedFrom`, and their rewind leads back to the score they replayed on, so undo drops only that change, and on the file fallback the agent commits the full composition with the strict base check. Accepted commits are persisted through the same atomic snapshot store before being broadcast to every window. The daemon also owns the only transport and audio player, broadcasting play, pause, seek, and tempo with a timestamp so every window draws the same hit line. It keeps a presence table (`clientId`, `pid`, focused track) and can atomically claim the first unfocused track for a new window. The daemon exits 30 seconds after its last window closes, removes its socket on SIGTERM, and a crashed daemon's socket and lock are reclaimed by the next window. If `dawgd` cannot be started (or `DAWG_DAEMON=0`), windows fall back to the snapshot under the file lock, watching the session directory with `fs.watch` (so renames and edits from other windows arrive immediately) with a 1 s backstop poll, or a 200 ms poll where watching is unavailable, with presence kept in per-window heartbeat files. `dawg sessions` lists sessions in the current workspace. `dawg render <out.wav> [--session <name|id>] [--import <file>]` reads the session record from disk (no daemon, no audio) and writes a stereo 16-bit WAV through the playback renderer; the same score always yields the same bytes, and the command prints the size and sha256. `/status` reports `status · <name> · rev <n> · <digest> · shared via dawgd` (or `saved locally · no daemon`), where the digest is the 16-hex composition digest dawgd broadcasts. In demo mode a drum track is seeded with a one-bar kick, snare and hat groove instead of melodic notes.

### Sessions, names and forks

Each session record carries bounded metadata alongside the score: `name` (1–40 printable characters), `nameSource` (`auto` or `user`), an optional `forkOf {sessionId, revision}`, the fingerprint the current auto-name was computed from, and a `version` counter. Records written before metadata existed load with an id-based auto name. Metadata writes are conditional (`expect {name?, nameSource?}`) and never touch the score revision or event log. Through `dawgd` they are a `meta` frame that the daemon applies, persists atomically and broadcasts; on the file fallback they run under the session lock, and polling windows pick up the newer `meta.version`. `/rename <name>` is unconditional and sets `nameSource=user`, so it wins over any auto-name computed against the old name, which arrives `stale` and is dropped. `/rename --auto` sets `nameSource=auto` and clears the stored fingerprint.

`/fork [name]` writes a new session with a snapshot of the composition at the current revision (not the event log), `forkOf` lineage and a numbered name: strip a trailing ` N` (N ≥ 2) from the parent, then take one more than the highest ` N` among sessions with that base. An explicit name that collides is suffixed the same way. The workspace pointer moves to the fork, so plain `dawg` resumes it. Undo does not stop at the fork point: the fork's history is its own events preceded by each ancestor's events up to the revision it was forked at, following `forkOf` at most 8 levels (stopping at cycles, missing parents or revisions beyond the parent's log) and keeping at most the store's event cap.

On launch, and after `/fork` or `/resume`, a window without `--track` sends an atomic `claim {draft: true}`. dawgd serializes claims on its event loop; the file fallback serializes them under the presence lock. The reply is the first track in score order that no live window has focused, or, when every track is taken, a fresh `track-N` id that is neither in the score nor focused by another window. A draft is only appended to the score (`track.attach`) on the window's first edit. `--session <name|id>` resolves an exact id, then an exact case-insensitive name, then a unique id prefix of at least four characters; ambiguous names list the candidates and exit.

The header shows the session name and, when more than one window is open, the window count. Renames, forks, claims and the all-tracks-open hint appear as activity cards. The session port exposes a structured sync status (`synced`, `syncing`, `conflict`, `offline`, `local`) that drives the header directly.

Auto-naming (`src/session/naming.ts`) is gated on a local musical fingerprint: tempo, a scale-fit key estimate from the pitch-class histogram (tonic and fifth weighted), sorted instrument families, register and density buckets, and effects, hashed into an order- and id-independent digest. After an accepted turn the namer waits for a quiet period, and skips the model when the fingerprint equals the one the current name came from or when fewer than three turns have passed since the last name (a structure change, such as a new instrument family, bypasses the turn gate). The prompt is one fingerprint line, the last two prompts truncated to 60 characters each, and the current name, with `max_tokens: 12`. The reply is untrusted: it is stripped to 2–4 lowercase words of at most 32 characters, and a reply equal to the current name keeps it (hysteresis). The write is conditional on the name and `nameSource` the request started from, and a newer request supersedes an older one, so a slow provider (xcb takes about 7 s) can never overwrite a user rename. Forks keep their ` N` suffix through auto-renames, and a name already used by another session is suffixed. The generator is an injectable `NameGenerator`; the default calls `generateText` from `src/agent/provider.ts` and falls back to the deterministic local name.

The `dawgd` protocol is newline-delimited JSON over a Unix socket in the session directory, or a hashed path under `$TMPDIR` when that path would exceed the platform socket-path limit. Every frame carries `v: 1`, frames are size-bounded, and every inbound frame is parsed from `unknown`. Clients send `hello`, `apply`, `transport`, `sync`, `focus`, `claim`, `meta`, and `ping`; the daemon replies with `welcome`, `result`, `snapshot`, `claimed`, `pong`, and typed `error` frames, and pushes `commit`, `transport`, `presence`, and `meta`.

The header (`dawg` · track · ▶/⏸ BPM · key · session · N windows, then model · rev · sync on the right; `test/tui.test.ts` freezes the order) sits above the highway. The highway sits above the activity strip and the prompt. Notes stream toward the hit line, and velocity sets glyph density (`░▒▓█`) and saturation. Beat and bar rules get stronger at each level. Sustains draw as beams with a decaying tail and a short ghost after release. Each hit runs approach glow → flash/burst at the line → fade. The hit line pulses on the beat, and a sweep marks the loop wrap. A track with no hits draws `<track> · empty · add C4 at 0 to start` (or `hit kick at 0` on a kit) in place of bar numbers and lane labels; the hit line stays. Drum tracks use one lane per voice with a legend; lane projection is pluggable (`LaneProjection` in `tui/highway.ts`). By default every unmuted track is overlaid through its own projection and accent, the focused track drawn on top at full strength and the others dimmed; `/view focus` restores the single-track view. Animation is derived from transport time, so frame rate never changes timing. Frames render into a retained cell buffer, only changed rows are written, and output is capped at about 30 fps.

Keys: `Space` (empty prompt) toggles playback. `Enter` submits, or queues in QUEUE mode. `Shift+Enter`/`Ctrl+J` inserts a newline, `Alt+Enter` queues and `Ctrl+Q` toggles STEER/QUEUE. `Ctrl+Z`/`Ctrl+Y` undo and redo, and `Ctrl+O` or `/transcript` opens the transcript, which scrolls with ↑/↓, PgUp/PgDn and Home/End, and `/` cycles its filter (all, requests, ops, errors). `Esc` cancels an agent turn, closes the overlay or clears the draft. `Ctrl+L` redraws and `Ctrl+C` exits. Bracketed paste keeps multiline text intact.

Themes: `/theme default|high-contrast|mono`, `--theme`, `DAWG_THEME`. Color falls back through truecolor, 256-color, 16-color and monochrome. `NO_COLOR` and `TERM=dumb` are supported. `/motion off`, `--reduce-motion` and `DAWG_REDUCE_MOTION=1` switch to static states in the same positions.

Other code reports into the activity strip through `ActivityFeed` (`tui/activity.ts`): `pushCard(text, {tone, baseRevision, resultRevision, hint})`, `pushError(text)`, `setSpinner(label | undefined)`, `setQueueDepth(n)` and `applyAgentEvent(event)`, which accepts the agent's streaming `AgentEvent`s unchanged. Command handlers return a `Receipt` (`{ok: true | false | "warn", text}`), so a failure such as `main is not a drum track` is red because it says so, not because of its wording; `receiptTone` only classifies the legacy strings that remain. The `^z undo` hint rides only on receipts that changed the score, and only the first three in a session. `/help`, `/sessions` and `/tracks` open a scrollable text overlay (`TuiApp.openText`) and leave one summary card in the strip; `/help` is generated from `src/commands/help.ts`, which also feeds `dawg --help` and the usage hints that answer an unknown `/word` or a near-miss such as `pan 3` without a model call.

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

Six more `AGENT_TOOLS` entries (`src/media/`) turn reference audio into material for a track. They work on files under the focused track's `tracks/<slug>/downloads/` (the same slug and write scope as `write_file`), return project-relative output paths so the model can chain them, and never install anything: a missing binary is reported with its install command. `dawg media <verb>` runs the same code from the shell, and `dawg media doctor` lists the backend, each binary, how it runs and how to install it.

- `download_audio {url, name?}`: YouTube only (`youtube.com`, `youtu.be`, `music.youtube.com`). Writes `<name>.wav` plus a `<name>.json` sidecar (title, duration, source URL, backend, sha256, time). The same source URL is reused instead of downloaded again. yt-dlp runs with `--no-playlist`, `--max-filesize 500m` and a 15 min budget.
- `split_stems {file}`: six stems (vocals, drums, bass, guitar, piano, other) into `<base>.stems/`, cached once present. 20 min budget.
- `analyze_audio {file}`: ffprobe metadata, then tempo, key, a beat grid and 240 waveform peaks computed in TypeScript, written to `<base>.analysis.json`; the model sees 48 peaks.
- `transcribe_notes {file, kind?, from?, to?}`: drums use a vendored onset classifier mapped to dawg kit voices (kick, snare, clap, tom, hat, openhat, rim); pitched stems run `basic-pitch`. Notes are quantized onto the analysis beat grid (run first when missing) and returned as a `note()`/`hit()` snippet plus `<base>.<kind>.notes.json`, at most 2048 notes.
- `import_sample {file, name, begin?, end?, root?}`: ffmpeg converts the file (or a trimmed window) to 48 kHz stereo PCM16 at `tracks/<slug>/samples/<name>.wav` and returns its sha256, duration and a `sampler({ name: "samples/<name>.wav" })` snippet (`{src, root, begin, end}` when given; `begin`/`end` are fractions of the file, `root` defaults to C4; a root adds `{ mode: "keyed" }`).
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

The gateway and OpenRouter share `src/agent/gateway.ts`, an OpenAI-compatible streaming client with tool calls that requests `stream_options.include_usage`. `src/agent/usage.ts` prices each usage chunk, using the provider's own `cost` when present and otherwise tokens × the models.dev price. It keeps the session total and a daily ledger in `~/.config/dawg/usage.json` (31 days, lock file plus atomic rename) that windows share, and draws the spend line under the prompt (`$0.12 session · $0.48 today · opus-5.5 · gateway`; `subscription` for xcb; `no model · dawg login` offline; it narrows by dropping today, then session). Billed web searches add to the same meter. Prices come from `https://models.dev/api.json`, cached in `~/.config/dawg/cache/` for 24 h, fetched with a timeout and size cap, with a stale cache preferred to nothing offline; on OpenRouter its own `/models` prices win. The picker's `~$0.004/prompt` is `TYPICAL_PROMPT` (≈ 9,400 input + 600 output tokens, measured from the system prompt, tool schemas and a fixture brief over about 2 requests) × price.

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

| Strudel                         | dawg                                                       | Behaviour                                                                                                  |
| ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `samples({ kick: "kick.wav" })` | `sampler({ kick: "samples/kick.wav" })`                    | one voice per name                                                                                         |
| `s("kick hat")`                 | `hits("kick", …)`, `hit("hat", …)` (oneshot mode)          | voices take pitch slots 36, 37, … in name order; a hit plays the whole sample, whatever the note length    |
| `note("c4 e4").s("vox")`        | `sampler({ vox: { src, root: "C4" } }, { mode: "keyed" })` | rate = 2^((pitch − root)/12); the note's length holds it, then a 10 ms release; several roots multi-sample |
| `.begin(0.25)` / `.end(0.5)`    | `begin: 0.25`, `end: 0.5`                                  | 0..1 fractions of the file                                                                                 |
| `.speed(2)` / `.speed(-1)`      | `speed: 2` / `speed: -1`                                   | rate and pitch together; negative plays the window backwards                                               |
| `.loop(1)`                      | `loop: true`                                               | repeats begin..end (5 ms crossfade) for the note's length, oneshot or keyed                                |
| `.cut(1)`                       | `choke: "hats"`                                            | a new hit in the group stops the sounding voice with a 5 ms fade                                           |
| `.gain(0.8)`                    | `gain: 0.8`                                                | 0..2, times velocity and the track volume                                                                  |
| `.slice(8, …)` / `.chop(8)`     | `slices("samples/break.wav", 8)`                           | eight voices with begin/end windows                                                                        |

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

| Command                                                    | Does                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/pack` or `/pack list`                                    | the built-in catalog and your added packs, with licenses                                                                                                                                               |
| `/pack add <url \| github:user/repo[/branch]> [as <name>]` | register a manifest (fetches the manifest only)                                                                                                                                                        |
| `/pack info <name>`                                        | license, source, sound names                                                                                                                                                                           |
| `/pack remove <name>`                                      | forget an added pack (built-ins stay)                                                                                                                                                                  |
| `/pack use <pack>/<sound>[:<n>] [as <voice>]`              | add one pack sound as a voice on the focused track                                                                                                                                                     |
| `/kit [<bank>]`                                            | turn the focused drum track into a sampler on a bank (`909` by default; `808`, `707`, `606`, `linn`, `lm1`, `dmx`, `cr78`, `uzu`, `dirt`, or any bank name like `RolandTR909`); `/kit list` lists them |

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
| Enter                       | add a row for a voice without one                 |
| Space                       | audition the voice                                |
| `x` / Delete, `f`           | remove the row and its notes / freeze it to notes |
| Esc                         | back (cancels typing, then closes)                |

## Chords

`core/chords.ts` is one pure, deterministic chord engine shared by the agent tools, the SDK helpers and play mode. Its input model follows the Telepathic Instruments ORC-1 Orchid; the parts Orchid does not document are dawg's own and are marked so.

From Orchid's documentation and reviews:

- Four chord-type buttons, `dim min maj sus`, and four extension buttons, `6 m7 M7 9`. Hold a type and press a root for the chord; extensions add notes on top of a type (or of a Key-mode chord) and any number of them combine (Maj + M7 + C = Cmaj7). Extensions never play alone.
- Key mode: once a key is set, every key plays the chord that fits the key (C major: D plays Dm). Type and extension buttons still work on top for less obvious choices.
- Voicing dial: each click moves the chord's lowest note up an octave, or its highest note down, walking through inversions and up or down the keyboard.
- Bass: an optional engine that plays a bass note under every chord.
- Performance modes: Strum (and 2-octave), Slop (humanised strum), Arpeggiator (and 2-octave, tempo-synced; more chord notes make a longer pattern), Pattern (fixed rhythms) and Harp (a sweep across several octaves).
- "Secret chords": an option makes certain combinations of type and extension buttons play extra chords; the table is not published.
- Orchid has no generator that writes a progression for you. Key mode is its "easy chord progressions" feature: you pick the order, every key is in key.

dawg's own design:

- Two types held together resolve through `COMBINED_TYPES`: dim+maj aug, maj+sus sus2, maj+min power chord (5), min+sus and dim+sus sus2, dim+min dim.
- Key-mode chords are the diatonic triads (sevenths when asked) of `major`, `minor`, `dorian`, `phrygian`, `lydian`, `mixolydian`, `locrian` and `harmonic-minor`. A key outside the scale plays the chord borrowed from the parallel major or minor when that scale has the note (C major: E♭, A♭, B♭), otherwise a passing diminished seventh.
- Voice leading: a voicing is the chord in root position from C4, rotated by the dial. When there is a previous chord, every rotation within one octave of the dial is scored by movement (each new voice's distance to the nearest old voice, plus the reverse, so common tones are free), kept within C3–G5 where it fits, and the cheapest wins; ties go to the rotation nearest the dial. Spread `open` drops the second voice from the top an octave (drop 2), `wide` also the fourth.
- Bass is the root (or slash bass) in C2–B2, one sustained note per chord.
- Perform modes `block`, `strum-up`, `strum-down` (1/32-beat gap), `arp-up`, `arp-down`, `arp-updown`, `arp-random` (seeded) with a grid-aligned `rate` and 1–4 `octaves`, and `harp` (a 1/16-beat upward sweep across the octaves that rings to the end of the chord).
- Progressions (dawg's "auto"): eleven presets (`axis` I–V–vi–IV, `sad-pop` vi–IV–I–V, `fifties` I–vi–IV–V, `ii-v-i`, `turnaround` I–vi–ii–V, `canon`, `aeolian` i–VI–III–VII, `andalusian` i–VII–VI–V, `minor-ii-v`, `dorian-vamp`, `mixolydian-rock` I–♭VII–IV–I) and four styles, `pop`, `jazz`, `modal` and `classical`, that walk a weighted graph of scale-degree transitions (tonic → predominant → dominant → tonic, with plagal and vi–IV moves for pop and the cycle of fifths for jazz) from I with a seeded PRNG. A progression of four or more chords ends on a dominant-function chord (V or vii°; IV or vii in modal) so the loop leads home. The same key, style, length and seed always give the same chords.

Agent. `suggest_progression {key?, chords? | style?, length?, seed?, sevenths?, inversion?, spread?}` (read-only) returns each chord's name, roman numeral, voicing and bass. `write_chords {trackId?, chords, key?, start?, beatsPerChord?, perform?, rate?, octaves?, strum?, velocity?, bass?, bassTrackId?, inversion?, spread?}` writes them as one revision. `chords` takes roman numerals in the key (`ii7`, `bVII`, `V/V`) or symbols (`Cm7`, `F/A`). The system prompt tells the agent to use these tools for chord parts, so its chords are diatonic and voice-led rather than hand-stacked.

SDK. `chord("Cm7", start, length, opts)` and `progression("ii7 V7 Imaj7", { key, from, each, perform, rate, octaves, strum, seed, voicing, spread, part })` expand to notes at evaluation; see [docs/project-format.md](./docs/project-format.md). The vendored SDK stays one import-free file: `core/sdk/v1.ts` carries a generated copy of the engine (`bun core/sdk/sync-chords.ts`, checked by a test).

## Play mode (computer keyboard)

`Ctrl-P` or `/play` turns the computer keyboard into a piano for the focused track, using the "musical typing" layout GarageBand, Logic, BandLab, FL Studio and Ableton share. `Esc` or `/play off` leaves it and every normal binding is back. Typing `/` starts a slash command without leaving the mode (`/click 40%`, `/play off`).

| Key                     | Does                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| `A S D F G H J K L ; '` | white keys C D E F G A B C D E F from the base octave              |
| `W E T Y U O P`         | black keys C♯ D♯ F♯ G♯ A♯ C♯ D♯ (none on `R` or `I`, like a piano) |
| `Z` / `X`               | octave down / up (clamped to the score's pitch range)              |
| `C` / `V`               | velocity down / up in steps of 16 (1–127, shown in the header)     |
| Shift + note            | sustained note: rings until a plain key or `Tab`                   |
| `Tab`                   | sustain latch on/off (off releases every sustained note)           |
| `R`                     | record arm on/off                                                  |
| `Shift-R`               | replace: bars you play over are cleared first (default: overdub)   |
| `M`                     | click on/off                                                       |
| `Space`                 | play/stop; with record armed and stopped, counts in, then records  |
| `Esc`                   | leave play mode                                                    |

The base octave follows the instrument: C3 (MIDI 48) by default, C2 for bass instruments or tracks named bass, C4 for saw/square/triangle/pluck leads. Kits start at C2, so `A` is the GM kick, `S` the snare, `T` the closed hat. On a one-shot sampler track the keys walk the voices in name order from slot 36 (`A` the first voice, `W` the second, chromatically), and the strip shows voice names; a keyed sampler starts at the C below its lowest root and repitches from it.

The header reads `PLAY  C3–F4  vel 100  ● REC  click ✓  grid 1/16` with a beat flash, and the row under it is the keyboard with sounding keys lit. Both repaint in place; nothing scrolls per note.

Notes sound through the track's own instrument, effects and volume, rendered by the same per-instrument voice code as the loop, and mix into the stream about 60 ms ahead of now (play mode lowers the queue lead from 200 ms and restores it on exit). That works over silence and over the playing loop. A muted or unsoloed track still sounds while you play it. With audio backend `none` the keys still record.

Terminals send key presses and auto-repeats, never key releases, so held notes are synthesized. A press sounds for one grid step; holding the key keeps it sounding while the OS auto-repeats it (after its repeat delay, usually 250–700 ms), and it ends about 120 ms after the last repeat. Hold notes shorter than the repeat delay come out one grid step long. Use Shift or the `Tab` latch for long notes.

Recording: with record armed and the transport running, each note is quantized to the grid (`/grid 1/16` by default; `1/4 1/8 1/8T 1/16 1/16T 1/32`), wrapped into the loop, and appended to the focused track as `addNote` operations when the playhead leaves the bar, so each recorded bar is one revision: one `Ctrl-Z` undoes a bar, other windows and the project files see it like any edit. Stopping commits the rest. The same pitch on the same step twice is one note. Replace removes the bar's earlier notes in the same revision. No agent and no network are involved.

## Click track

`/click on|off|<volume>` (`/click 40%`, `/click 0.4`) or `M` in play mode. An accented downbeat and lighter beats at the transport tempo and the score's meter, mixed as a separate monitoring bus. It is never part of a loop render, a stem, `dawg render`, or `/export`; tests compare those byte for byte with the click on. `/count-in 0|1|2` sets how many bars of click play before recording starts (default 1); the header counts down and flashes the beat, so it also works with backend `none`.

## Menus

`/menu` or `Ctrl-K` (on an empty prompt, in play mode too) opens the edit menu, drawn with the same overlay as the model picker. Every edit the agent can make is reachable from it with keys alone, and each row shows its current value and the command it runs, so the menu teaches the commands. `/menu effects` opens a section directly.

| Section    | Rows                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Track      | name, instrument, mute, solo, volume, pan                                                      |
| Parameters | instrument; a sampler's mode and voices (synths have no knobs beyond the instrument)           |
| Sounds     | drum kits (`/kit`), instruments (piano, `gm_*` soundfonts), use a pack sound, packs            |
| Effects    | filter (on, cutoff, resonance), delay (on, beats, feedback, mix), reverb (on, mix, size)       |
| Automation | each `AUTOMATION_LANES` lane: its points as `beat N  value` rows, add points, ramp, clear lane |
| Mix        | every track's volume, pan, mute and solo; choosing another track focuses it first              |
| Transport  | play, tempo, beats per bar, loop bars, grid, click, count-in                                   |

| Key                         | Does                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `↑` `↓` / `k` `j`           | move                                                                       |
| `Enter` / `Space`           | open a section, toggle, pick from a list, or start typing a value          |
| `→` `←` / `l` `h` / `+` `-` | nudge a number by its step (cutoff moves 25%), cycle a choice, open / back |
| digits                      | type a value; `Enter` sets it, `Esc` cancels                               |
| `/`                         | filter the current list by name, value or command                          |
| `x` / `Delete`              | remove the selected automation point                                       |
| `Esc`                       | clear the filter, then back one level, then close                          |

Automation rows take `beat:value` pairs (`2:800` or `0:200 4:8000`); a ramp is two pairs, start and end, and the renderer interpolates between points. Turning an effect's first field up switches it on with defaults. Each change runs the command it shows through the normal prompt path, so it is one `ScoreOperation`, one receipt, one undo step, and it syncs to other windows and the project files.

## Release

Bump `version` in `package.json` and add its section to `CHANGELOG.md` in a pull request, then merge it. When Check passes on `main`, the annotated `v<version>` tag, the immutable GitHub Release (tarball, `SHA256SUMS` and a provenance attestation) and the npm publish of `@hraness/dawg` follow automatically. See [docs/publishing.md](./docs/publishing.md).
