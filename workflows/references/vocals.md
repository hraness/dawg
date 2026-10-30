# Worded stock vocals

The studio pipeline speaks words with stock Kokoro, retains word tokens, then fits
syllables to musical timing with WORLD. Save each spec, selected take, slices, model
identity and output hash in the project. Detect the configured backend explicitly;
missing inference dependencies must not break ordinary saved-song playback.

For original songs, use speech rhythm, low conversational verses, pickups, gaps and
long stressed vowels. Protect consonants rather than stretching every sound equally.
Use clean words as the lead and keep doubles/chops behind them. Effects on wordless
fills must not destroy the original lyric line. Rerender or rewrite unclear original
words; requested covers preserve their actual lyrics.

For source-matched singing, use continuous source F0, local chronological phonetic
anchors and dynamics. Check split ASR tokens, repeated short phrases and trailing
words. A word center is not its onset. Preserve quiet starts, held tails and wordless
activity outside lyric windows. Blend overlaps smoothly; binary clip counts cause
gain steps. The stock spectral envelope remains the stock voice's.

Independently assess rendered pitch and octave errors, onset/coverage, words and
tone. Compare the same source crop with the same recognizer settings. Held vowels
and chants can confuse recognition in both recordings; report that uncertainty.
File integrity and close F0 tracking do not prove exact timbre or performance.

## Authored vocal-book spec

For a complete chart, prefer `sing_chart`: it builds the required line, chop and
held-vowel parts. `perform_chart` attaches that exact cached take from the stable
`tracks/vocals/` namespace, independently of the track being inspected.

`generate_vocals {file:"tracks/vocals/spec.json"}` and `dawg vocals sing <spec.json>`
accept a JSON book. `bpm` and `parts` are required. Each part is
`[name, beats, notes, optionalSettings]`; notes contain `syl`, `beat`, `len` and
`midi`. Beats are relative to that part, and each note must end within its part.
Only stock `bf_emma` is accepted. This is an original three-word example:

```json
{
  "voice": "bf_emma",
  "bpm": 122,
  "root": 62,
  "parts": [
    [
      "line",
      4,
      [
        { "syl": "we", "beat": 0, "len": 0.4, "midi": 62 },
        { "syl": "keep", "beat": 0.5, "len": 0.8, "midi": 64 },
        { "syl": "light", "beat": 1.5, "len": 1.5, "midi": 66 }
      ]
    ]
  ]
}
```

Defaults are a quarter-beat lead-in, unchanged formants, clarity/speed 1 and
human/seed 0. Optional per-note expression is scoop, fall, glide, vib, dyn, air,
gap and legato. `syllables` names existing chop parts; `lines` maps existing line
names to their exact beat lengths; `heads` selects up to three of those lines.
Without `lines`, non-chop/non-hold parts become lines automatically. A generic
one-line book can be used as a sampler; a complete chart book also needs the held
and chop parts its production layers consume, which `sing_chart` supplies.

The runtime bounds specs to 512 KiB, 128 parts, 4096 notes and 600 seconds of
book audio. Accepted output includes WAV, spec, book, metadata, slices and hashes.
Use the returned pinned sample reference; never add a user take to the public
bundled-sample catalog. The CLI's setup/doctor reports backend availability.
