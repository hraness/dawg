# Changelog

All notable changes to dawg are recorded here. Versions follow [semantic versioning](https://semver.org); releases are published as immutable GitHub Releases with a tarball, `SHA256SUMS` and a build provenance attestation.

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
