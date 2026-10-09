# dawg project format, SDK, workspace tools and sampling (design, 2026-10-06)

Status: sections 1 to 3 and the sampler schema from section 6 are implemented. Where the shipped code differs from this design (manifest shape, `dawg init` instead of initializing on launch, per-check incremental `tsc` instead of a watch program, sync in every window), the **Project files and SDK** section of [DAWG.md](../DAWG.md) is the contract.

Owner direction: agents should edit the session directly as typechecked TypeScript on Bun through a versioned SDK; every track gets a directory the agent can download into, read, write and edit, and agents may read every other track's directory; add web search, local YouTube download, stem splitting and transcription (soundfish tools); pave the road for audio sampling the way Strudel does it.

## 1. Project layout (the directory you run `dawg` in)

```
dawg.json                  project manifest, 1 line of JSON: {"dawg":1,"sdk":"1"}
tsconfig.json              extends .dawg/sdk/tsconfig.json (paths map "dawg" → vendored SDK)
song.ts                    tempo, meter, bars, key, track order; imports tracks/*/track.ts
tracks/
  bass/
    track.ts               the track: instrument, mix, effects, automation, notes
    samples/               audio the track's sampler references (relative paths)
    notes.md               free scratch for the agent and the user (never parsed)
    downloads/             yt-dlp output, stems, transcripts (gitignored by default)
  drums/
    track.ts
.dawg/                     runtime state owned by dawg
  session                  pointer (existing)
  sessions/<id>.json       event log + snapshot (existing; still the sync substrate)
  sdk/v1.ts                vendored SDK copy, refreshed by dawg on start when newer
  sdk/tsconfig.json        generated: strict, noEmit, paths {"dawg": ["./sdk/v1.ts"]}
  assets/<sha256>.pcm      decoded sample cache (f32 interleaved + header), rebuildable
  tsbuild/                 tsc incremental state
.gitignore                 adds .dawg/assets, .dawg/tsbuild, tracks/*/downloads
```

- `dawg` in a directory without `dawg.json` initializes the project (same moment it creates `.dawg/` today) and prints what it wrote. Nothing outside the cwd is touched.
- A track directory name is the track's slug (`bass`, `drums`, `keys 2` → `keys-2`). The track id in the score stays the stable id; `track.ts` carries `id`. Renaming a track renames the directory via `track.ts`.
- Sessions: one project = one song. `/fork` copies `song.ts` + `tracks/` into `../<name>/`? No. Keep forks inside the project: `.dawg/sessions/*` remain, and the working files mirror the _current_ session (the pointer). `/resume <other>` rewrites the working files from that session's snapshot after confirming the current files are committed (evaluate-equals-snapshot). This keeps one set of files per project and avoids two sources of truth.

## 2. SDK v1 (`core/sdk/v1.ts`, published as `@hraness/dawg/sdk` and vendored to `.dawg/sdk/v1.ts`)

Zero-dependency, pure builders over the existing score model. Everything is in beats (numbers) for the author; the SDK converts to integer ticks with `ticksPerBeat` from the song. Types are strict and documented, because the type signatures and JSDoc are what the coding agent reads.

```ts
// tracks/bass/track.ts
import { track, note, seq, every } from "dawg";

export default track({
  id: "t-bass", // stable; dawg assigns on create
  name: "bass",
  instrument: "bass", // synth voice name, "kit", or sampler(...)
  volume: 0.8,
  pan: 0,
  filter: { cutoff: 800, resonance: 0.2 },
  delay: null,
  automation: {
    filter: [
      [0, 400],
      [8, 2000],
    ],
  }, // [beat, value]
  notes: [
    note("A1", 0, 1), // pitch, start beat, length beats, velocity = 0.8
    note("A1", 1.5, 0.5, 0.6),
    ...seq("E2 G2 A2", { from: 4, step: 0.5, len: 0.5 }),
  ],
});
```

```ts
// song.ts
import { song } from "dawg";
import bass from "./tracks/bass/track.ts";
import drums from "./tracks/drums/track.ts";

export default song({
  tempo: 120,
  meter: [4, 4],
  bars: 4,
  key: "A minor",
  tracks: [bass, drums],
});
```

- `song()`/`track()` return plain frozen data (`SongSpec`, `TrackSpec`), no classes, no I/O; the SDK is importable by tsc and by Bun.
- Drum tracks: `instrument: "kit"` and `hit("kick", 0)`/`hits("kick", every(1))` helpers; GM pitches stay the storage form.
- Rhythm rows (additive): `rhythm: [euclid("kick", 4, 16), euclid("hat", 7, 16, 2, { swing: 0.15 }), grid("snare", "....X.......x...")]` on a kit or oneshot-sampler track. `euclid`, `euclidRot` and `euclidLegato` take Strudel's argument order and produce Strudel's patterns and rotation direction. The rows are stored on the track as `rhythm: RhythmRow[]` (`core/euclid.ts`) and the evaluator expands them into ordinary notes, so the score, renderer, diff and daemon see notes and the rows remain the editable source. The printer writes the rows and omits the notes they generate; a row whose lane no longer matches its generated notes is printed as plain hits instead. See **Rhythm** in DAWG.md for the T-1 parameter set.
- Drum patterns and kits (additive, SDK 1.4.0): `pattern("boom-bap")` returns a library pattern's rows (`DRUM_PATTERNS`, `findPattern`), so `rhythm: pattern("house")` or `[...pattern("house"), euclid("rim", 5, 16)]` is a valid track. `kit: "syn808" | "syn909" | "acoustic" | "lofi" | "electro" | "trap"` on a `kit` track chooses a synthesized kit (`core/kits.ts`); without it the track renders byte-identically to earlier versions. `euclid(voice, pulses, steps, options)` is accepted as a shorthand for rotate 0, and the printer writes `euclid(voice, pulses, steps, 0, options)` so older vendored SDKs read it.
- Effects (additive, SDK 1.5.0): `filter: { type: "hpf", cutoff: 300, resonance: 0.1, ftype: "24db" }`, `delay: { beats: 0.75, feedback: 0.35, mix: 0.25, pingpong: true, highcut: 5000 }`, `reverb: { mix: 0.3, size: 0.6, fade: 3, predelay: 0.02 }` and insert effects by name, `fx: { autofilter: { sync: 0.25, shape: "random" }, distort: { drive: 3 }, chorus: {} }`, with lanes under `automation.fx` (`"autofilter-cutoff": [[0, 400], [4, 4000]]`). The printer writes only fields that differ from the defaults (an effect on at its defaults prints `chorus: {}`). The chain order, parameters, ranges, defaults and Strudel names are the table under **Effects** in DAWG.md; `core/fx.ts` is the single source.
- ZzFX sounds (additive, SDK 1.10.0): `instrument: "z_square"` (also `z_sine`, `z_triangle`, `z_sawtooth`, `z_tan`, `z_noise`) with `synth: { slide: -4, pitchJump: 300, pitchJumpTime: 0.1, lfo: 0.25, zcrush: 0.3 }`; the other ZzFX controls are `zrand`, `curve`, `deltaSlide`, `zmod`, `zdelay` and `tremolo` (units in DAWG.md "Synth"). Scores without them render as before.
- Orbits and ducking (additive, SDK 1.9.0): `fx: { orbit: { orbit: 2 } }` puts a track on orbit 2 (1 when absent) and `fx: { duck: { orbit: 2, depth: 0.85, attack: 0.25 } }` makes this track's note onsets duck every other audible track on orbit 2 (Strudel's `duckorbit`/`duckdepth`/`duckattack`/`duckonset`). Ducking is a deterministic gain on finished stems, applied where tracks are summed, so cold, cached and worker renders stay byte-identical; scores without them render as before.
- Synth voice (additive, SDK 1.6.0): `instrument: "supersaw", synth: { attack: 0.6, release: 1.2, unison: 6, detune: 0.25, lpf: 1800 }` on a synth track, with Strudel's parameter names (aliases are accepted and normalised), `partials: [1, 0.5, 0.33]` for the additive `user` sound, and lanes under `automation.fx` as `"synth-lpf"`. Only set parameters are stored and printed. The parameters, ranges, defaults and Strudel names are the table under **Synth** in DAWG.md; `core/synth.ts` is the single source.
- Song master (additive, SDK 1.17.0): `song({ master: { eq: { high: 2 }, glue: { ratio: 2 }, tape: { drive: 3 }, width: { width: 1.2, mono: 120 }, limiter: { ceiling: -1 }, target: -14 } })` stores `master` on the score: units in the fixed order eq, glue, tape, width, limiter, each optional with the parameters in `MASTER_SPECS` (`core/master.ts`, tabled in DAWG.md "Master and loudness"), and `target` an integrated loudness in LUFS (-40 to -3; the SDK takes numbers, not target names). The chain runs after the track, orbit-bus and duck sum. A score without `master` has no `master` key in its JSON and renders byte-identically; loop renders process warm-up repeats and keep one steady-state pass, so the loop seam is clean.
- Convolution reverb, orbit buses and raw ZzFX arrays (additive, SDK 1.12.0): `reverb: { mix: 0.3, size: 0.5, ir: { src: "builtin:hall" } }` (also `room`, `plate`, a `pack:` sound or a project WAV, sha256-pinned like sampler files); `fx: { orbit: { orbit: 2, shared: true } }` sends the track to its orbit's shared delay and reverb; `...zzfx([, , 129, 0.01, , 0.15, 2])` in `track({...})` expands to a `z_*` instrument and named synth controls, so the score never stores the array. Scores without them render as before.
- Wavetables (additive, SDK 1.8.0; project tables SDK 1.11.0): `instrument: wavetable("basic", { wt: 0.4 })`, `wavetable("wt_digital:2")` (pinned pack sound) or `wavetable("./wavetables/vox.wav")`, a project WAV relative to the track's directory, stored as `tracks/<slug>/wavetables/vox.wav` and sha256-pinned on evaluation like sampler files. Paths with `..`, `:` or a leading `/` are rejected.
- Sample controls (additive, SDK 1.13.0): sampler voices also take Strudel's `loopBegin`, `loopEnd`, `clip`, `fit`, `unit` ("r" | "c" | "s"), `accelerate` and `squiz` (`loopAt n` is `speed: 1/n, unit: "c"`). Voices without them play as before.
- Sample fitting (additive, SDK 1.20.0): sampler voices also take `bpm` (the sample's own tempo, 20..400), `len` (the window's length in song beats, > 0, up to 1024) and `fitmode` (`"repitch"` default, `"beats"`, `"tones"`), written after the existing keys in that order. Precedence `fit` > `bpm` > `len`; `fitmode` other than `repitch` needs one of them. Windows follow the song's tempo map. Voices without them play as before.
- Tempo maps, meter changes and track time (additive, SDK 1.14.0): `song({ tempo: 120, bars: 28, time: [tempo(32, 140), rit(48, 16, 80), aTempo(72), fermata(91, 2), meter(16, [7, 8])] })`; `ramp(at, bpm, "linear" | "exp")` glides into a tempo, `accel` mirrors `rit`, `aTempo(at)` and `tempoPrimo(at)` (SDK 1.19.0) step back; marks must fall inside the song (`bars`). Stored as the song's `time: { tempo: [{tick, bpm, ramp?}], meter: [{bar, beatsPerBar, beatUnit}], fermatas: [{tick, beats}] }` (`bar` 0-based). `track({ ..., time: { rate: 1.5, phase: 0.5, cycle: 3 } })` or `time: phasing(3, 48)` (continuous drift) or `time: stepPhasing(3, { hold: 8 })` (Piano Phase steps, SDK 1.19.0, SDK 1.19.0, stored as `steps: {shift, hold, drift}` with `shift` in ticks) gives a track its own tempo ratio, offset and loop length for polytempo, polymeter and Reich-style phasing (stored with phase and cycle in ticks). The helpers store what they compute, so a saved song prints them expanded: `rit(48, 16, 80)` as `tempo(48, …)` plus `ramp(64, 80)`, and `phasing(3, 48)` as `{ rate, cycle }`. A fermata holds the meter's felt beat (a dotted quarter in 6/8) and may hold it for at most 16.777 s (the slowest tempo a MIDI file can write). Ticks stay score time; seconds come from the map. Scores without them render as before. See **Tempo and meter** in DAWG.md.
- Sections and form (additive, SDK 1.18.0): `song({ sections: [{ name: "verse", startBar: 0, bars: 8, mute: ["pad"] }, { name: "chorus", startBar: 8, bars: 8, vary: { lead: { transpose: 12, gain: 0.9 } } }], form: "intro verse*2 chorus outro", loopSection: "chorus" })`. Bars are 0-based. `form` is a string (`*n` repeats a section) or an array of names and `{ section, repeat }` entries. The score stores them as song-level `sections`, `form` and `loopSection` (absent when empty), bounded by `SCORE_LIMITS` (64 sections, 32-character names unique ignoring case, 128 form entries, repeat 1..16). Playback and export follow the form; `loopSection` affects playback only. The printer writes `form` as a string when every name is plain, and omits all three fields when the song has none, so 0.4 projects reprint byte-for-byte. `diffScores` uses one added operation, `setSections`, which replaces the sections, form and loop together. Sections cooperate with the 0.5 time and master fields: a section or form pass plays at the tempo map sounding in its bars (ramps and fermatas included), tracks with their own `time` are cut by what they actually play, the song master runs once over the whole arranged render, and sections cannot be combined with `time.meter` changes (bars must all have one length).
- Sampler (section 5): `instrument: sampler({ kick: "samples/kick.wav", vox: { src: "samples/vox.wav", root: "C4", begin: 0.1, end: 0.6 } })`.
- Chords (SDK 1.3.0, additive): `chord("Cm7", start, length, opts)` and `progression("ii7 V7 Imaj7", { key: "C major", each: 4, perform: "arp-up", rate: 0.5, part: "both" })` expand to plain `note()`s at evaluation, so the score and reprints only ever hold notes. Numerals read in `key` (`ii7`, `bVII`, `V/V`), symbols work anywhere; each chord takes the inversion nearest the previous one (`lead: false` turns that off). Options: `voicing` (Orchid-style dial, -12..12), `spread` (`close`/`open`/`wide`), `perform` (`block`, `strum-up`, `strum-down`, `arp-up`, `arp-down`, `arp-updown`, `arp-random`, `harp`, `slop` from SDK 1.5.0, and `pattern` from SDK 1.7.0 with `pattern: "bossa"` or a number 1–13), `rate`, `octaves`, `strum`, `seed`, `vel`, `anchor`, `part` (`chords`/`bass`/`both`), and from SDK 1.7.0 `bass` (`off`, `chords`, `unison`, `single` or `solo`, Orchid's bass modes; it overrides `part`, and `solo` gives bass only). The vendored file stays import-free: `core/sdk/v1.ts` carries a generated copy of `core/chords.ts` between marker lines (`bun core/sdk/sync-chords.ts`; a test fails when it is stale), so the SDK, play mode and the agent's chord tools produce identical notes.
- Expression and performance (additive, SDK 1.15.0; `core/expression.ts`): a note or hit takes an options object, `note("C4", 0, 1, 0.8, { art: "staccato", glide: 0.05, bend: [[0, -200], [0.25, 0]], vibrato: { rate: 5.5, depth: 30, delay: 0.2 } })` (`art` is short for `articulation`: `staccato`, `legato`, `accent`, `tenuto`, `marcato`, `ghost`; `bend` points are `[at 0..1 of the note, cents]`), and `expr(notes, { art: "ghost" })` applies one setting to many notes (a note's own fields win). A track takes `glide: 0.08` or `{ time, mode: "legato" | "mono" | "poly" }`, `pedal: [[beat, "down" | "half" | "up"], ...]`, `velocityCurve: "soft" | "hard" | "fixed"` or `{ curve: "fixed", fixed: 0.6 }`, and `humanize: { timing: ms, velocity: %, length: %, seed }`. The score stores notes' `articulation`, `glide` (s), `bend` (`{at, cents}[]`), `vibrato` and `humanize` (`{timing?, velocity?, length?}`, replacing the track's amounts for that note and seeded by the track's seed; `{}` keeps the note exact), and the track's `glide` (`{time, mode}`), `pedal` (`{tick, state}[]`), `velocityCurve` (`{curve, fixed?}`; `linear` is never stored) and `humanize` (`{timing?, velocity?, length?, seed}`). All are applied at render to copies of the notes (articulation, humanize velocity, pedal, glide and mono voicing on the written timing, humanize timing and length, velocity curve, in that order), so the stored notes stay as written and a project without them renders byte-identically. A note's `vibrato` replaces the synth's `vib`/`vibmod`, its `bend` replaces `penv` (bend positions are 0..1 of the articulated length, before pedal and humanize), and a gliding note ignores ZzFX `slide`. Chords, the mono line and glides are decided on written positions; humanize then moves each performed note (and its glide chain) together. An expressive note in a rhythm row's lane counts as a hand edit, so the row prints as plain hits.
- Tunings and scales (additive, SDK 1.16.0): `song({ tuning: "19-edo" })` or `song({ tuning: { name: "slendro", ref: 432, root: "D4", map: "nearest" } })` sets the song tuning, and `track({ tuning })` a track's own. A tuning object holds one table source (`name` from the library, `edo: 19`, `ratios: ["9/8", "5/4", "3/2", "2/1"]`, `cents: [231, 474, 717, 955, 1200]` or `scl: "tunings/slendro.scl"` with an optional `kbm: "tunings/white.kbm"`), plus `ref` (the 12-TET A4 in Hz, 440, that fixes the root key's pitch), `root` (the key of degree 0, a note name or MIDI number) and `map` (`"linear"` or `"nearest"`); a bare string is a library name. The table's last entry is the period. Scala files live in the project (by convention `tunings/`), are parsed per the Scala specification at evaluation, and print back by path; the stored score carries the resolved `cents` (and keymap) so renders never read files. Pitches take a cents suffix, `note("E4-14c", 0)` and `seq("C4 E4-14c")`, stored as an optional note `cents` (±1200). `key` accepts any scale in the library (`"D dorian"`, `"E hijaz"`, `"C yaman"`, `"C messiaen-3"`). Scores without them render byte-identically; see **Tunings and scales** in DAWG.md.
- Plucked strings (additive, SDK 1.21.0): `instrument: stringed("sitar", { buzz: 0.8 })` stores `instrument: "string"` and an optional track `string` object holding `preset` (one of the 22 names in `STRING_PRESETS`, `core/strings.ts`) and any `STRING_PARAMS` overrides (numbers clamped to each range, enum params by name, Strudel aliases such as `decay` and `jawari` rewritten to `ring` and `buzz`). Keys print preset first, then in `STRING_PARAMS` order. The field is appended last and only when present; `TrackPatch` `string: null` clears it. The engine plays only when the instrument is `"string"` and the field is present, so legacy words (`sitar`, `ebass`, `pluck`) render as before. Automation lanes `string-ring`, `string-damp`, `string-pos`, `string-bright`, `string-mute`, `string-buzz`, `string-vib`, `string-vibmod` and `string-gain` are track effect lanes. Scores without the field render byte-identically.
- Versioning: the import specifier is `"dawg"`, resolved by the generated tsconfig to `.dawg/sdk/v1.ts`. `dawg.json.sdk` is the major. A dawg release may add fields and helpers to v1 (additive, defaults preserve old files byte-for-byte on reprint); a breaking change is `v2.ts` plus a `dawg migrate` that rewrites files. dawg refuses to run a project whose `sdk` major it does not ship and says which dawg version does.
- Evaluation contract: `song.ts` must default-export a `SongSpec`; the evaluator runs `bun --no-install --smol .dawg/sdk/eval.ts <project>` in a subprocess with env scrubbed to `PATH`/`HOME`, cwd = project, 10 s timeout, 1 MiB stdout, and the result is parsed from `unknown` by the existing `scoreFromJSON` (never trusted because it came from TS). No network, no `Bun.spawn` reachable: the subprocess runs with `--no-addons`; a file that does I/O is not prevented but is documented as unsupported and is caught by the budget.
- Typecheck: `typescript` becomes a real dependency (installed by `bun add -g` and `npm i -g`). The daemon keeps one `ts.createWatchProgram` warm over the project (incremental, `.dawg/tsbuild`), so a check after the first takes ~100–300 ms. Errors are returned as `file:line:col message` and are what the agent sees as a tool result. The TUI shows `types ✓`/`types ✗ 2` in the header's sync slot.

## 3. Two-way sync (files ⇄ score ⇄ daemon)

Canonical rule: **the evaluated files are the content; the session event log is the history and the multi-window sync substrate.**

- files → score: on save (fs.watch on `song.ts`, `tracks/**/track.ts`, debounced 150 ms) or on the agent's `apply_files` tool, dawg typechecks, evaluates, diffs the new score against the current revision and commits the diff as one `files.apply` revision (ops list computed by `core/diff.ts`: track add/remove/patch, note add/remove/update, tempo/meter/key). Through the daemon this is an `apply` pinned to the base revision like any other edit; other windows receive the commit and their highways update. Undo works per apply.
- score → files: when a revision arrives from anywhere other than this project's files (TUI command, tool call, another window, undo), dawg reprints only the affected `track.ts`/`song.ts` with the deterministic printer (`core/sdk/print.ts`). A file whose evaluation already equals the score is never rewritten, so the author's layout and comments survive until someone else edits that track. Reprint output is prettier-stable and round-trips (`print(eval(print(x))) === print(x)`, tested).
- Loop prevention: writes carry a content hash recorded in `.dawg/sync.json`; a watch event whose file hash matches a hash we just wrote is ignored.
- Conflicts: if the file's base revision (recorded per file in `.dawg/sync.json`) is behind and the evaluated diff touches a track changed since, dawg still applies (last writer wins at the note level, same as today's rebase), and posts an activity card naming the track.
- Legacy: a project with `.dawg/sessions/*` and no `song.ts` is printed once on first start. No other migration (the owner has never run earlier versions).

## 4. Workspace and web tools (agent)

Tools added to `AGENT_TOOLS` and to the xcb JSON-ops catalog. Scope is the project directory; every path is resolved, must stay under the project after `realpath`, symlinks that leave it are rejected, and `.dawg/` is read-only except through dawg.

| tool                        | scope                                | notes                                                                                                                                                   |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_files(path?)`         | whole project                        | sizes, mtimes, 500 entries max                                                                                                                          |
| `read_file(path, range?)`   | whole project                        | 256 KiB cap, text only; binary reports size/type                                                                                                        |
| `write_file(path, content)` | own track dir, `song.ts`, `notes.md` | atomic, 1 MiB cap                                                                                                                                       |
| `edit_file(path, old, new)` | same as write                        | exact single match, like Claude Code's Edit                                                                                                             |
| `apply_files()`             | —                                    | typecheck + evaluate + commit; returns diagnostics or the applied summary; also runs automatically after any `write_file`/`edit_file` on a `*.ts`       |
| `web_search(query)`         | —                                    | provider chain: `BRAVE_SEARCH_API_KEY` → OpenRouter `web` plugin when provider is OpenRouter → DuckDuckGo lite HTML; 8 results, title/url/snippet, 10 s |
| `fetch_url(url)`            | —                                    | http(s) only, 2 MiB cap, HTML → readable text, 20 s, no private ranges                                                                                  |

"Own track dir" is the focused track's `tracks/<slug>/`. Agents in other windows may read it. A write outside scope returns a diagnostic naming the allowed roots. The brief gains a 30-line project tree (names and sizes) and the focused track's `notes.md` head (1 KiB).

## 5. Media tools (local only; soundfish lineage)

What soundfish actually has (`/Users/bg/Documents/soundfish`, private, same owner): a song importer `scripts/soundfish-import-song.ts` + `lib/song-import/` that takes a YouTube URL → **StemDeck** (a local HTTP service at `127.0.0.1:8000` that runs yt-dlp, ffmpeg, Demucs `htdemucs_6s` and beat/downbeat detection) → per-stem **Basic Pitch** (Python CLI, audio → MIDI) for pitched stems and a pure-TS drum classifier (`lib/song-import/drums.ts`, nine GM classes) for the drum stem → quantized loops. "Transcription" there means audio → notes, not speech. Pure-TS helpers worth vendoring with attribution: `drums.ts`, `grid.ts` (beat grid, `secondsToBeat`), `basic-pitch.ts` (CSV parsing, per-stem parameters), `lib/audio-media/{wav,waveform}.ts`. The injected `SongImportRuntime` is the same shape as our `CommandRunner`.

All dawg media tools run locally, report progress cards, write under `tracks/<slug>/downloads/`, and are budgeted (time and bytes). Each tool probes its backend at first use and, if missing, returns the exact install command instead of failing silently; nothing is auto-installed. Media backend (`src/media/backend.ts`): `stemdeck` when `GET http://127.0.0.1:8000/api/health` (or `DAWG_STEMDECK_URL`) answers, because it does download + stems + beat grid in one job and the owner already runs it; otherwise `direct`: `yt-dlp`, `ffmpeg/ffprobe`, `uv tool run demucs`, `uv tool run basic-pitch`. Both produce the same files.

| tool                                                                    | backend                                                                                                                                           | output                                                                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `download_audio(url, name?)`                                            | yt-dlp (`-x --audio-format wav`) or StemDeck job; YouTube hosts only, credentials and fragment stripped (soundfish `validateYoutubeUrl`)          | `downloads/<slug>.wav` + `<slug>.json` (title, duration, source url, sha256)                                                                   |
| `split_stems(file)`                                                     | `demucs -n htdemucs_6s` via uv, or the StemDeck job's stems                                                                                       | `downloads/<slug>.stems/{vocals,drums,bass,guitar,piano,other}.wav`                                                                            |
| `analyze_audio(file)`                                                   | `ffprobe` + StemDeck beat grid when available, else TS onset autocorrelation tempo; key from a pitch-class estimate (reuse `naming.ts` scale fit) | `<file>.analysis.json`: `{duration, sampleRate, tempo?, beats[]?, downbeats[]?, key?, peaks[240]}`                                             |
| `transcribe_notes(file, {kind: "pitched"\|"drums", from?, to?, bars?})` | pitched: Basic Pitch CLI with soundfish's per-stem parameters; drums: vendored TS classifier                                                      | `<file>.notes.json` (`TimedNote[]` in seconds) plus a quantized `track.ts`-ready snippet aligned to the song grid using the analysis beat grid |
| `import_sample(file, name, {begin?, end?, root?})`                      | `ffmpeg` to 48 kHz wav when needed                                                                                                                | copies into `tracks/<slug>/samples/<name>.wav`, returns the `sampler` snippet to add to `track.ts`                                             |
| `transcribe_lyrics(file, {lang?})`                                      | `whisper-cli` (whisper.cpp, installed here; model `ggml-base.en` under `~/.cache/dawg/whisper/`, fetched on first use after a card says so)       | `<file>.lyrics.json` (segments with times) + `.txt` — lowest priority, lands last                                                              |

The composite the owner will actually type is "pull this YouTube track in and give me its bass line": `download_audio` → `split_stems` → `analyze_audio` → `transcribe_notes(bass)` → the agent writes `tracks/bass/track.ts`. Each tool is separately callable so the agent can stop early, and the brief lists the files already in `downloads/` so it never redoes work.

## 6. Sampling in the score (Strudel-aligned)

Score v2 adds one optional track field; everything else is unchanged and v1 documents decode as v2 with the field absent.

```ts
type Sampler = Readonly<{
  /** Map of voice name → sample ref. Notes address voices by pitch (keyed mode) or by voice (one-shot mode). */
  voices: Readonly<Record<string, SampleRef>>;
  /** "oneshot": each voice is a drum-like hit at its own pitch slot; "keyed": one voice is pitch-shifted across the keyboard from `root`. */
  mode: "oneshot" | "keyed";
}>;
type SampleRef = Readonly<{
  src: string; // project-relative path, inside tracks/<slug>/samples/
  sha256: string; // content hash; renders are deterministic because the cache is keyed by it
  root?: number; // MIDI note the file plays at (keyed mode), default 60
  begin?: number; // 0..1 fraction, like Strudel begin
  end?: number; // 0..1 fraction, like Strudel end
  gain?: number; // 0..2
  speed?: number; // playback rate, like Strudel speed; negative reverses
  loop?: boolean; // sustain by looping begin..end
  choke?: string; // choke group, like Strudel cut
}>;
```

- Storage: `instrument: "sampler"` and `sampler: Sampler` on the track. Oneshot voices are assigned pitch slots in name order starting at 36 so the drum lane projection and `add_drums`-style tools keep working; the SDK hides the slot numbers.
- Renderer: decodes WAV (PCM 16/24/32/f32) in TS; other formats go through `ffmpeg -f f32le` into `.dawg/assets/<sha256>.pcm` once. Playback is linear-interpolated resampling with `speed`, pitch shift by rate in keyed mode, `begin/end`, `loop` with a 5 ms crossfade, per-voice choke, and it feeds the same filter/delay/reverb chain. No time-stretch in v1 (same as Strudel's default).
- Highway: sampler tracks use the drum lane projection in oneshot mode and the pitch projection in keyed mode; the legend shows voice names.
- Strudel road: `voices` maps 1:1 to `samples({name: url})`, and `begin/end/speed/loop/choke/loopBegin/loopEnd/clip/fit/unit/accelerate/squiz` map to `.begin().end().speed().loop().cut().loopBegin().loopEnd().clip().fit().unit().accelerate().squiz()`. A future `dawg export strudel` emits `s("kick snare").bank(...)` from the oneshot track and `note(...).s("vox")` from keyed tracks. Slicing (`slice`, `chop`, `fit`) is expressed as derived voices in the SDK (`slices(ref, 8)` → eight voices with begin/end), so the score never needs a slice op.
- Limits: ≤ 64 voices per track, ≤ 50 MiB per sample file, ≤ 10 minutes per file, ≤ 512 MiB decoded cache (LRU).

## 7. Delivery plan (lanes, in dependency order)

A. **format + SDK + sync** (`core/sdk/v1.ts`, `core/sdk/print.ts`, `core/sdk/eval.ts`, `core/diff.ts`, score v2 sampler schema (validation only), project init, tsc watch program in the daemon, fs.watch apply, `dawg check`, header types slot, docs in DAWG.md, round-trip and property tests).
B. **workspace + web tools** (depends on A's `apply_files`; can start on `list/read/write/edit`, `web_search`, `fetch_url` and path scoping immediately).
C. **media tools** (independent of A except `import_sample`, which lands last).
D. **sampler playback + highway** (depends on A's schema).
Each lane: worktree under `~/src/track-wt/<lane>`, PR with tests, rebase on main before merge, squash auto-merge. 0.3.0 ships sign-in + A + B; 0.4.0 ships C + D, or everything in 0.3.0 if they land within the same window.
