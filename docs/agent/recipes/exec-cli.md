---
id: exec-cli
title: Run ffmpeg and other audio CLIs directly
tools: [exec, audio]
---

Goal: anything the `audio` tool does not cover, with the real CLI.

`exec` takes an argv array (no shell, no pipes), runs in the project folder and returns the tails of stdout and stderr. Allowed: ffmpeg ffprobe sox rubberband yt-dlp demucs basic-pitch aubio* whisper-cli; any command only when the human turned on shell (`/agent shell on`). Paths must stay inside the project and may not write into `.dawg/`.

```tool
{"tool":"exec","args":{"argv":["ffprobe","-hide_banner","-show_format","tracks/drums/downloads/break.wav"]}}
```

```tool
{"tool":"exec","args":{"argv":["ffmpeg","-y","-i","tracks/vox/downloads/take.wav","-af","highpass=f=120,acompressor","tracks/vox/samples/take-hp.wav"],"timeoutSec":120}}
```

Long output is truncated; the result names a log id. Page it with `log` and `offset`:

```tool
{"tool":"exec","args":{"log":"exec-1","offset":4000}}
```

Prefer `audio` for cut, slice, stretch, pitch, fades and analysis: it snaps cuts, writes sidecars and records history rows. Use exec for format quirks, filters and tools audio does not wrap. After the current turn reads web content (fetch_url, web_search, download_audio or exec yt-dlp), trusted shell exec is refused until the next turn; allowlisted exec still runs.
