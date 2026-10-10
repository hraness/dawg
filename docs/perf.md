# Performance

What a person feels in dawg, measured end to end, and how to re-measure it.

```sh
bun run bench:perf                    # everything, about 3 minutes
bun run bench:perf -- render live     # some groups
bun run bench:perf -- --quick         # fewer samples
bun run bench:perf -- --out run.json  # also save JSON
```

The harness lives in `bench/perf/`:

- `pty.ts` drives the real `dawg` TUI in a pseudo-terminal (temp dir, temp
  HOME). Audio goes through `DAWG_AUDIO_PLAYER` to `sink.ts`, which logs each
  silence→sound edge with the wall time its bytes arrived and the time the
  engine scheduled them to play. **Audible** means the scheduled time; a real
  device adds its own output buffer on top (ffplay and CoreAudio: roughly
  10–40 ms), which no PTY measurement can see. **Audio bytes** is when the
  rendered PCM reached the player, which isolates render cost from the queue
  lead.
- `frame.ts` times `TuiApp.render` with a moving playhead.
- `render.ts` times offline `renderScorePcm` per bar for the heavy presets.
- `live.ts` times `LiveSynth.render` for one key press in-process: a fresh
  process, a fresh process after the play-mode pre-warm, and later pitches.
- `patch.ts` is the patcher inner-loop micro-benchmark from the language
  assessment (16 voices × 12 nodes, 48 kHz), interpreted and hand-fused.

Medians and p95 are over the sample count `n`. Cold rows are one sample per
process; `live.ts` cold rows spawn a process per sample.

## Baseline (origin/main 7c02ebc, Apple M-series, bun 1.3.14)

Calibration loop 1.91 ms.

| metric                                                        | median |   p95 | unit   | id                              |
| ------------------------------------------------------------- | -----: | ----: | ------ | ------------------------------- |
| startup → first frame                                         |    126 |   203 | ms     | `startup.frame`                 |
| startup → first playable note heard                           |    253 |   397 | ms     | `startup.note`                  |
| key → audio bytes, first press, sine                          |   15.9 |  15.9 | ms     | `key.bytes.cold.sine`           |
| key → audio bytes, later, sine                                |   0.76 |  3.35 | ms     | `key.bytes.warm.sine`           |
| key → audible, first press, sine                              |   69.4 |  69.4 | ms     | `key.cold.sine`                 |
| key → audible, later, sine                                    |   65.7 |  76.5 | ms     | `key.warm.sine`                 |
| key → audio bytes, first press, saw                           |   9.17 |  9.17 | ms     | `key.bytes.cold.saw`            |
| key → audio bytes, later, saw                                 |   0.48 |  3.56 | ms     | `key.bytes.warm.saw`            |
| key → audible, first press, saw                               |   62.8 |  62.8 | ms     | `key.cold.saw`                  |
| key → audible, later, saw                                     |   65.2 |  79.5 | ms     | `key.warm.saw`                  |
| key → audio bytes, first press, grand                         |   9.34 |  9.34 | ms     | `key.bytes.cold.grand`          |
| key → audio bytes, later, grand                               |   0.95 |  2.63 | ms     | `key.bytes.warm.grand`          |
| key → audible, first press, grand                             |   74.4 |  74.4 | ms     | `key.cold.grand`                |
| key → audible, later, grand                                   |   68.0 |  78.4 | ms     | `key.warm.grand`                |
| key → audio bytes, first press, tonewheel                     |   24.7 |  24.7 | ms     | `key.bytes.cold.tonewheel`      |
| key → audio bytes, later, tonewheel                           |   7.32 |  13.4 | ms     | `key.bytes.warm.tonewheel`      |
| key → audible, first press, tonewheel                         |   78.6 |  78.6 | ms     | `key.cold.tonewheel`            |
| key → audible, later, tonewheel                               |   67.2 |  80.3 | ms     | `key.warm.tonewheel`            |
| key → audio bytes, first press, bowed-cello                   |   29.2 |  29.2 | ms     | `key.bytes.cold.bowed-cello`    |
| key → audio bytes, later, bowed-cello                         |   1.19 |  10.2 | ms     | `key.bytes.warm.bowed-cello`    |
| key → audible, first press, bowed-cello                       |   68.2 |  68.2 | ms     | `key.cold.bowed-cello`          |
| key → audible, later, bowed-cello                             |   66.4 |  80.3 | ms     | `key.warm.bowed-cello`          |
| key → audio bytes, first press, sing-choir                    |   12.0 |  12.0 | ms     | `key.bytes.cold.sing-choir`     |
| key → audio bytes, later, sing-choir                          |   0.92 |  15.1 | ms     | `key.bytes.warm.sing-choir`     |
| key → audible, first press, sing-choir                        |   76.2 |  76.2 | ms     | `key.cold.sing-choir`           |
| key → audible, later, sing-choir                              |   69.9 |  81.0 | ms     | `key.warm.sing-choir`           |
| key → audio bytes, first press, granular-swarm                |   27.5 |  27.5 | ms     | `key.bytes.cold.granular-swarm` |
| key → audio bytes, later, granular-swarm                      |   1.03 |  23.6 | ms     | `key.bytes.warm.granular-swarm` |
| key → audible, first press, granular-swarm                    |   74.7 |  74.7 | ms     | `key.cold.granular-swarm`       |
| key → audible, later, granular-swarm                          |   71.9 |  89.8 | ms     | `key.warm.granular-swarm`       |
| typed command → receipt                                       |   49.9 |  57.7 | ms     | `command.receipt`               |
| typed command → new audio bytes                               |   31.4 |  55.8 | ms     | `command.bytes`                 |
| typed command → audible change                                |    229 |   239 | ms     | `command.audible`               |
| fader step → audible change                                   |   93.7 |   106 | ms     | `fader.audible`                 |
| song.ts saved → TUI updated                                   |    222 |   230 | ms     | `sync.file`                     |
| agent: Enter → first token shown                              |   25.2 |  57.9 | ms     | `agent.first-token`             |
| frame time, playing, 80x24                                    |   0.38 |  0.46 | ms     | `frame.80x24`                   |
| bytes per frame, 80x24                                        |   0.93 |  1.56 | KiB    | `frame.bytes.80x24`             |
| frame time, playing, 200x50                                   |   1.26 |  1.43 | ms     | `frame.200x50`                  |
| bytes per frame, 200x50                                       |   1.91 |  5.46 | KiB    | `frame.bytes.200x50`            |
| render vocoder, 22.05 kHz                                     |   97.6 | 100.0 | ms/bar | `render.vocoder.22.05k`         |
| render vocoder, 48 kHz                                        |    209 |   212 | ms/bar | `render.vocoder.48k`            |
| render sing-choir, 22.05 kHz                                  |   30.3 |  32.4 | ms/bar | `render.sing-choir.22.05k`      |
| render sing-choir, 48 kHz                                     |   76.7 |  76.8 | ms/bar | `render.sing-choir.48k`         |
| render cellos-section, 22.05 kHz                              |   35.9 |  36.4 | ms/bar | `render.cellos-section.22.05k`  |
| render cellos-section, 48 kHz                                 |   72.6 |  72.7 | ms/bar | `render.cellos-section.48k`     |
| render granular-swarm, 22.05 kHz                              |   18.6 |  24.8 | ms/bar | `render.granular-swarm.22.05k`  |
| render granular-swarm, 48 kHz                                 |   40.0 |  40.3 | ms/bar | `render.granular-swarm.48k`     |
| render psola, 22.05 kHz                                       |   15.0 |  15.1 | ms/bar | `render.psola.22.05k`           |
| render psola, 48 kHz                                          |   38.0 |  38.1 | ms/bar | `render.psola.48k`              |
| render reverb-hall, 22.05 kHz                                 |   15.1 |  16.9 | ms/bar | `render.reverb-hall.22.05k`     |
| render reverb-hall, 48 kHz                                    |   50.2 |  50.5 | ms/bar | `render.reverb-hall.48k`        |
| render reverb-algo, 22.05 kHz                                 |   6.59 |  7.93 | ms/bar | `render.reverb-algo.22.05k`     |
| render reverb-algo, 48 kHz                                    |   14.0 |  14.0 | ms/bar | `render.reverb-algo.48k`        |
| key render, first press, no pre-warm, saw                     |   6.60 |  6.70 | ms     | `live.cold.saw`                 |
| key render, first press after play-mode warm, saw             |   6.61 |  6.76 | ms     | `live.prewarmed.saw`            |
| key render, new pitch, warm, saw                              |   1.93 |  3.28 | ms     | `live.warm.saw`                 |
| key render, first press, no pre-warm, saw-fx                  |   31.6 |  32.2 | ms     | `live.cold.saw-fx`              |
| key render, first press after play-mode warm, saw-fx          |   32.6 |  34.1 | ms     | `live.prewarmed.saw-fx`         |
| key render, new pitch, warm, saw-fx                           |   15.5 |  20.5 | ms     | `live.warm.saw-fx`              |
| key render, first press, no pre-warm, grand                   |   11.1 |  11.2 | ms     | `live.cold.grand`               |
| key render, first press after play-mode warm, grand           |   10.8 |  11.4 | ms     | `live.prewarmed.grand`          |
| key render, new pitch, warm, grand                            |   4.11 |  10.1 | ms     | `live.warm.grand`               |
| key render, first press, no pre-warm, tonewheel               |   14.2 |  16.1 | ms     | `live.cold.tonewheel`           |
| key render, first press after play-mode warm, tonewheel       |   14.3 |  14.6 | ms     | `live.prewarmed.tonewheel`      |
| key render, new pitch, warm, tonewheel                        |   4.42 |  6.95 | ms     | `live.warm.tonewheel`           |
| key render, first press, no pre-warm, bowed-cello             |   22.5 |  22.7 | ms     | `live.cold.bowed-cello`         |
| key render, first press after play-mode warm, bowed-cello     |   22.3 |  23.0 | ms     | `live.prewarmed.bowed-cello`    |
| key render, new pitch, warm, bowed-cello                      |   7.26 |  9.57 | ms     | `live.warm.bowed-cello`         |
| key render, first press, no pre-warm, sing-choir              |   76.8 |  77.7 | ms     | `live.cold.sing-choir`          |
| key render, first press after play-mode warm, sing-choir      |   21.6 |  21.9 | ms     | `live.prewarmed.sing-choir`     |
| key render, new pitch, warm, sing-choir                       |   20.6 |  24.2 | ms     | `live.warm.sing-choir`          |
| key render, first press, no pre-warm, granular-swarm          |   45.9 |  46.1 | ms     | `live.cold.granular-swarm`      |
| key render, first press after play-mode warm, granular-swarm  |   46.0 |  46.8 | ms     | `live.prewarmed.granular-swarm` |
| key render, new pitch, warm, granular-swarm                   |   7.44 |  24.1 | ms     | `live.warm.granular-swarm`      |
| patch runner, flat interpreter (16 voices x 12 nodes, 48 kHz) |   13.4 |  20.6 | ns     | `patch.interp`                  |
| patch runner, fused voice loop                                |   5.98 |  14.4 | ns     | `patch.fused`                   |

### Reading it

- **Keys** are already quick: about 65 ms key → scheduled audio, of which
  60 ms is play mode's fixed queue lead (`PLAY_LEAD_MS`). This baseline is
  the stdin-player path. The native sink cuts the lead to 15 ms; see heard
  latency below. Rendering the note
  costs 1–30 ms and runs off the main thread.
- **Typed commands** reach the screen in about 50 ms but are heard about
  230 ms later: the edit re-renders the loop off-thread and swaps it in for
  every frame not yet written, and the transport keeps a 200 ms lead queued.
- **Sync** from an editor save is dominated by the 150 ms debounce.
- **Startup** spends about 80 ms importing modules before the first frame.
- **Frames** cost about 1 ms at 200×50, so frame diffing is not a felt cost.
- **Renders**: the vocoder is the heaviest preset by far, about 210 ms per
  bar at 48 kHz. A bar at 120 BPM lasts 2 s, so it is still faster than real
  time, but an edit to an eight-bar vocoder loop waits well over a second
  before it is heard.

## Heard latency (loopback)

The PTY rows above stop at the time the engine scheduled a sound. The
loopback bench measures what a listener actually waits for: key → engine →
player → device → speaker.

```sh
DAWG_SINK_LIB=native/sink/target/release/libdawg_sink.dylib \
  bun bench/sink-latency.ts native 40      # or ffplay, sox
```

The engine plays 10 ms clicks into a loopback output (BlackHole 2ch on
macOS) and the native sink captures the same device's input. The clock starts
right before `engine.noteOn`, where a keypress hands over its rendered note,
and stops at the click's onset in the capture. That onset frame is mapped to
host time with the sink's per-buffer input timestamps. Synth render time is
excluded; it is the `live.*` rows above. The native sink plays to the device
by name. ffplay has no device option, so for its runs the macOS default output
was switched to BlackHole and then switched back.

Apple M-series, macOS, bun 1.3.14, engine at 22.05 kHz, device at 48 kHz:

| backend                                               | heard p50 |   p90 |   min–max |    notes heard |
| ----------------------------------------------------- | --------: | ----: | --------: | -------------: |
| ffplay (stdin pipe, 60 ms lead, 20 ms pump)           |  78–89 ms | 87–98 |     67–99 |    57% (17/30) |
| native sink (15 ms lead, 5 ms pump, 128-frame buffer) |   17.0 ms |  20.0 | 13.7–21.1 | 100% (110/110) |
| native sink, `DAWG_PLAY_LEAD_MS=8`                    |    6.4 ms |   9.1 |   3.4–9.7 |   100% (60/60) |

- **ffplay** adds 20 to 40 ms on top of its 60 ms lead, and its onsets
  spread over a 20 ms pump tick. ffplay also dropped about 4 in 10 of the
  short clicks. The engine's pipe stream had all of them: the same run
  written to a file instead of ffplay contained 20 out of 20. At a 48 kHz
  engine rate ffplay dropped none, but its heard latency rose to about
  230 ms because SDL's buffer grows with the rate.
- **The native sink** is the 15 ms lead, plus up to 2.7 ms of device buffer,
  plus the device's output latency (2.7 ms on BlackHole). It has no pipe and
  no player buffer, and its pump runs every 5 ms. The MacBook Pro speakers
  report 4.9 ms of output latency instead of BlackHole's 2.7 ms, so on the
  built-in speakers expect about 19 ms. The underrun counter stayed at 0
  throughout.
- **The lead is the remaining knob.** It has to cover the 5 ms pump plus
  event-loop jitter; Bun's timer is under 1 ms late at p99 (see the language
  assessment). At 8 ms there were still no underruns in these runs. The
  default stays at 15 ms to leave margin for GC pauses and busy machines.
  `dawg doctor` prints the lead in use.

## Changes

Each row: what changed, which metric moved (median), and the PR. Every
change below leaves the 16-bit PCM of the bench presets byte-identical (I
hashed it before and after), so no golden was re-pinned.

| change                                                                                                  | metric                                      |      before |       after | PR         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------: | ----------: | ---------- |
| default queue lead 200 → 100 ms, never grown for off-thread renders                                     | typed command → audible                     |      229 ms |      113 ms | #145       |
|                                                                                                         | fader step → audible                        |     93.7 ms |     78.1 ms | #145       |
| project sync debounce 150 → 40 ms                                                                       | song.ts saved → TUI updated                 |      222 ms |     86.5 ms | #145       |
| play-mode warm pre-renders every voice, not only sing                                                   | first key render after warm, granular swarm |     46.0 ms |     15.4 ms | #145       |
|                                                                                                         | same, bowed cello                           |     22.3 ms |     6.39 ms | #145       |
|                                                                                                         | same, grand                                 |     10.8 ms |     3.72 ms | #145       |
|                                                                                                         | same, sing choir                            |     21.6 ms |     10.8 ms | #145, #146 |
|                                                                                                         | same, saw + filter, reverb, delay           |     32.6 ms |     15.1 ms | #145       |
|                                                                                                         | same, tonewheel                             |     14.3 ms |     5.92 ms | #145       |
| vocoder hot loops in JIT-friendly helpers, allocation-free formant response, sing loudness aim memoised | render vocoder, 48 kHz                      |  209 ms/bar | 51.9 ms/bar | #146       |
|                                                                                                         | render sing choir, 48 kHz                   | 76.7 ms/bar | 29.3 ms/bar | #146       |
| FFT stages walk memory in order; legacy waves pick their tone once per note                             | render reverb hall, 48 kHz                  | 50.2 ms/bar | 12.6 ms/bar | #146       |
|                                                                                                         | render PSOLA, 48 kHz                        | 38.0 ms/bar | 13.7 ms/bar | #146       |
|                                                                                                         | render reverb algo, 48 kHz                  | 14.0 ms/bar | 7.63 ms/bar | #146       |
|                                                                                                         | key render, warm, saw + fx                  |     15.5 ms |     15.1 ms | #146       |
| bow friction `** -4` → reciprocal squared twice; Thiran Newton step with the closed-form derivative     | render cellos section, 48 kHz               | 72.6 ms/bar | 48.7 ms/bar | #146       |

Unchanged on purpose: in these PTY runs key → audible stays about 65 ms
because the ffplay path's 60 ms lead (`PLAY_LEAD_MS`) dominates it. The
native sink (#147, "Heard latency" above) cuts that lead to 15 ms. Frames
already cost about 1 ms at 200×50, startup is module loading (see below),
and the patch runner was not changed.

## After (origin/main 8b85a0d, same machine)

Calibration loop 1.77 ms.

| metric                                                        |      median |         p95 |   n | id                              |
| ------------------------------------------------------------- | ----------: | ----------: | --: | ------------------------------- |
| startup → first frame                                         |      123 ms |      138 ms |  10 | `startup.frame`                 |
| startup → first playable note heard                           |      256 ms |      271 ms |  10 | `startup.note`                  |
| key → audio bytes, first press, sine                          |     2.81 ms |     2.81 ms |   1 | `key.bytes.cold.sine`           |
| key → audio bytes, later, sine                                |     0.42 ms |     2.38 ms |  12 | `key.bytes.warm.sine`           |
| key → audible, first press, sine                              |     56.7 ms |     56.7 ms |   1 | `key.cold.sine`                 |
| key → audible, later, sine                                    |     65.7 ms |     77.4 ms |  12 | `key.warm.sine`                 |
| key → audio bytes, first press, saw                           |     2.43 ms |     2.43 ms |   1 | `key.bytes.cold.saw`            |
| key → audio bytes, later, saw                                 |     0.42 ms |     1.51 ms |  12 | `key.bytes.warm.saw`            |
| key → audible, first press, saw                               |     76.4 ms |     76.4 ms |   1 | `key.cold.saw`                  |
| key → audible, later, saw                                     |     66.1 ms |     79.7 ms |  12 | `key.warm.saw`                  |
| key → audio bytes, first press, grand                         |     3.81 ms |     3.81 ms |   1 | `key.bytes.cold.grand`          |
| key → audio bytes, later, grand                               |     0.40 ms |     2.33 ms |  12 | `key.bytes.warm.grand`          |
| key → audible, first press, grand                             |     75.7 ms |     75.7 ms |   1 | `key.cold.grand`                |
| key → audible, later, grand                                   |     66.0 ms |     80.3 ms |  12 | `key.warm.grand`                |
| key → audio bytes, first press, tonewheel                     |     3.82 ms |     3.82 ms |   1 | `key.bytes.cold.tonewheel`      |
| key → audio bytes, later, tonewheel                           |     2.78 ms |     6.39 ms |  12 | `key.bytes.warm.tonewheel`      |
| key → audible, first press, tonewheel                         |     67.9 ms |     67.9 ms |   1 | `key.cold.tonewheel`            |
| key → audible, later, tonewheel                               |     73.0 ms |     80.0 ms |  12 | `key.warm.tonewheel`            |
| key → audio bytes, first press, bowed-cello                   |     4.83 ms |     4.83 ms |   1 | `key.bytes.cold.bowed-cello`    |
| key → audio bytes, later, bowed-cello                         |     0.44 ms |     3.73 ms |  12 | `key.bytes.warm.bowed-cello`    |
| key → audible, first press, bowed-cello                       |     73.3 ms |     73.3 ms |   1 | `key.cold.bowed-cello`          |
| key → audible, later, bowed-cello                             |     67.6 ms |     80.4 ms |  12 | `key.warm.bowed-cello`          |
| key → audio bytes, first press, sing-choir                    |     4.72 ms |     4.72 ms |   1 | `key.bytes.cold.sing-choir`     |
| key → audio bytes, later, sing-choir                          |     3.92 ms |     19.5 ms |  12 | `key.bytes.warm.sing-choir`     |
| key → audible, first press, sing-choir                        |     68.5 ms |     68.5 ms |   1 | `key.cold.sing-choir`           |
| key → audible, later, sing-choir                              |     78.0 ms |     85.3 ms |  12 | `key.warm.sing-choir`           |
| key → audio bytes, first press, granular-swarm                |     4.74 ms |     4.74 ms |   1 | `key.bytes.cold.granular-swarm` |
| key → audio bytes, later, granular-swarm                      |     0.72 ms |     22.5 ms |   6 | `key.bytes.warm.granular-swarm` |
| key → audible, first press, granular-swarm                    |     81.4 ms |     81.4 ms |   1 | `key.cold.granular-swarm`       |
| key → audible, later, granular-swarm                          |     72.6 ms |     88.3 ms |   6 | `key.warm.granular-swarm`       |
| typed command → receipt                                       |     47.4 ms |     53.2 ms |  10 | `command.receipt`               |
| typed command → new audio bytes                               |     13.5 ms |     29.8 ms |  10 | `command.bytes`                 |
| typed command → audible change                                |      113 ms |      129 ms |  10 | `command.audible`               |
| fader step → audible change                                   |     78.1 ms |     96.4 ms |  10 | `fader.audible`                 |
| song.ts saved → TUI updated                                   |     86.5 ms |      152 ms |  10 | `sync.file`                     |
| agent: Enter → first token shown                              |     25.4 ms |     61.5 ms |  10 | `agent.first-token`             |
| frame time, playing, 80x24                                    |     0.40 ms |     0.48 ms | 500 | `frame.80x24`                   |
| bytes per frame, 80x24                                        |    0.93 KiB |    1.56 KiB | 500 | `frame.bytes.80x24`             |
| frame time, playing, 200x50                                   |     1.32 ms |     1.44 ms | 500 | `frame.200x50`                  |
| bytes per frame, 200x50                                       |    1.91 KiB |    5.46 KiB | 500 | `frame.bytes.200x50`            |
| render vocoder, 22.05 kHz                                     | 27.9 ms/bar | 32.9 ms/bar |   5 | `render.vocoder.22.05k`         |
| render vocoder, 48 kHz                                        | 51.9 ms/bar | 52.0 ms/bar |   5 | `render.vocoder.48k`            |
| render sing-choir, 22.05 kHz                                  | 13.9 ms/bar | 15.0 ms/bar |   5 | `render.sing-choir.22.05k`      |
| render sing-choir, 48 kHz                                     | 29.3 ms/bar | 29.5 ms/bar |   5 | `render.sing-choir.48k`         |
| render cellos-section, 22.05 kHz                              | 23.6 ms/bar | 24.4 ms/bar |   5 | `render.cellos-section.22.05k`  |
| render cellos-section, 48 kHz                                 | 48.7 ms/bar | 48.8 ms/bar |   5 | `render.cellos-section.48k`     |
| render granular-swarm, 22.05 kHz                              | 18.5 ms/bar | 24.8 ms/bar |   5 | `render.granular-swarm.22.05k`  |
| render granular-swarm, 48 kHz                                 | 40.4 ms/bar | 40.7 ms/bar |   5 | `render.granular-swarm.48k`     |
| render psola, 22.05 kHz                                       | 6.34 ms/bar | 6.36 ms/bar |   5 | `render.psola.22.05k`           |
| render psola, 48 kHz                                          | 13.7 ms/bar | 13.9 ms/bar |   5 | `render.psola.48k`              |
| render reverb-hall, 22.05 kHz                                 | 4.80 ms/bar | 7.90 ms/bar |   5 | `render.reverb-hall.22.05k`     |
| render reverb-hall, 48 kHz                                    | 12.6 ms/bar | 12.7 ms/bar |   5 | `render.reverb-hall.48k`        |
| render reverb-algo, 22.05 kHz                                 | 3.67 ms/bar | 4.90 ms/bar |   5 | `render.reverb-algo.22.05k`     |
| render reverb-algo, 48 kHz                                    | 7.63 ms/bar | 7.92 ms/bar |   5 | `render.reverb-algo.48k`        |
| key render, first press, no pre-warm, saw                     |     6.30 ms |     6.40 ms |   5 | `live.cold.saw`                 |
| key render, first press after play-mode warm, saw             |     2.93 ms |     3.09 ms |   5 | `live.prewarmed.saw`            |
| key render, new pitch, warm, saw                              |     1.02 ms |     3.24 ms |  60 | `live.warm.saw`                 |
| key render, first press, no pre-warm, saw-fx                  |     30.1 ms |     30.7 ms |   5 | `live.cold.saw-fx`              |
| key render, first press after play-mode warm, saw-fx          |     15.1 ms |     16.1 ms |   5 | `live.prewarmed.saw-fx`         |
| key render, new pitch, warm, saw-fx                           |     15.1 ms |     20.3 ms |  60 | `live.warm.saw-fx`              |
| key render, first press, no pre-warm, grand                   |     10.7 ms |     10.8 ms |   5 | `live.cold.grand`               |
| key render, first press after play-mode warm, grand           |     3.72 ms |     4.58 ms |   5 | `live.prewarmed.grand`          |
| key render, new pitch, warm, grand                            |     4.10 ms |     10.0 ms |  60 | `live.warm.grand`               |
| key render, first press, no pre-warm, tonewheel               |     13.7 ms |     13.9 ms |   5 | `live.cold.tonewheel`           |
| key render, first press after play-mode warm, tonewheel       |     5.92 ms |     6.06 ms |   5 | `live.prewarmed.tonewheel`      |
| key render, new pitch, warm, tonewheel                        |     4.05 ms |     6.75 ms |  60 | `live.warm.tonewheel`           |
| key render, first press, no pre-warm, bowed-cello             |     21.0 ms |     22.4 ms |   5 | `live.cold.bowed-cello`         |
| key render, first press after play-mode warm, bowed-cello     |     6.39 ms |     6.48 ms |   5 | `live.prewarmed.bowed-cello`    |
| key render, new pitch, warm, bowed-cello                      |     5.84 ms |     8.26 ms |  60 | `live.warm.bowed-cello`         |
| key render, first press, no pre-warm, sing-choir              |     59.6 ms |     60.0 ms |   5 | `live.cold.sing-choir`          |
| key render, first press after play-mode warm, sing-choir      |     10.8 ms |     11.5 ms |   5 | `live.prewarmed.sing-choir`     |
| key render, new pitch, warm, sing-choir                       |     9.41 ms |     13.2 ms |  60 | `live.warm.sing-choir`          |
| key render, first press, no pre-warm, granular-swarm          |     43.4 ms |     44.6 ms |   5 | `live.cold.granular-swarm`      |
| key render, first press after play-mode warm, granular-swarm  |     15.4 ms |     16.1 ms |   5 | `live.prewarmed.granular-swarm` |
| key render, new pitch, warm, granular-swarm                   |     7.26 ms |     22.2 ms |  60 | `live.warm.granular-swarm`      |
| patch runner, flat interpreter (16 voices x 12 nodes, 48 kHz) |     13.3 ns |     13.7 ns |   7 | `patch.interp`                  |
| patch runner, fused voice loop                                |     5.63 ns |     18.1 ns |   7 | `patch.fused`                   |

## CI gates

`bench/perf/gate.test.ts` runs in `bun run check`. It renders the
vocoder, choir, cellos, reverb hall and PSOLA presets at 48 kHz, and times
the first choir key after the play-mode warm. Each budget is a ratio to the
calibration loop (`calibrate()` in `stats.ts`): a slow shared runner gets a
larger budget in proportion. Each budget sits about 3x above today's cost
and below the cost before this work, so a gate trips only when a fix is
lost, not on runner noise.

## Not done here, with numbers

- **Startup.** First frame is about 120 ms, and nearly all of it is loading
  328 modules (5.7 MB of source). Lazy-loading the agent, style and menu
  modules saves under 3 ms because the cost is spread across all of them.
  A `bun build --target=bun` bundle of `src/main.ts` halves `dawg --version`
  (140 → 70 ms). Shipping it changes packaging (`bin`, `files`, the release
  smoke test), and every `new Worker(new URL(...))` and `import.meta.url`
  read would need an audit, so it is a proposal for the release lane.
- **Rust.** No hot spot here gains 2x from Rust over the restructured TS.
  A prototype of the bowed-string waveguide loop, with the same arithmetic
  and the same output sum, ran 1.9 ns/sample in Bun against 4.5–5.2
  ns/sample as a release Rust binary. The language assessment's patcher
  numbers agree: fused TS matches fused Rust (Rust/TS 0.96x). The wins came
  from JIT-friendly structure, not from the language.
- **Math kernel** (polynomial sin/exp so goldens match across platforms):
  this would re-pin every golden. It buys portability, not speed, so it
  belongs in its own change.
