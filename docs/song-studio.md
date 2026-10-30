# Make a song and listen as it develops

Describe the song in chat. The agent writes the music, chooses sounds and effects,
and works on the arrangement and mix. The current house style is detailed hyperpop
with diatonic major harmony and stock British `bf_emma` singing the actual words.

The overview shows every track across the song. While the agent writes a track,
its horizontal piano roll follows the notes. Click a track to inspect it; Ctrl-P
pins or unpins it. Ctrl-T returns to the overview. Page Up/Down inspect time in the
piano roll; Follow returns to the moving cursor. A pin keeps your track selected
while work continues elsewhere.

Space on an empty prompt plays or pauses. Alt-Left/Right and the section buttons
seek between sections. These controls work during generation. The first coherent
draft starts automatically, and later edits update playback. A pause or seek you
make takes priority over an earlier automatic start. An instrumental draft remains
labeled while singing prepares.

“Saved” means notes or assets have been committed. “Rendering” means the listening
buffer is still being prepared. “Audible” identifies the revision that has reached
playback. “Buffering” means the current region is unavailable; it is not a completed
song. You can press Play before the whole arrangement is finished.

Enter sends a request. While generation runs, another sentence steers its next
step. Escape cancels generation and retains accepted changes. Ctrl-O opens the
chat transcript. Ctrl-Z undoes a score edit. Manual editors are available through
`/tape` and `/play`; they are optional.

## Original songs

The agent reads the bundled `original-house` workflow, plans an original hook and
words, commits a musical draft, generates singing, develops repeats and checks the
result. All outputs belong to the project, including immutable vocal takes and
the durable job under `.dawg/workflows/`.

The same original-song driver runs from the shell:

```sh
dawg make "bright hyperpop about a phone left on a train"
dawg workflow status --json
```

`make` saves an attempt-specific `songs/<job>/chart-e0-a1.json` and an
`instrumental.track.json` checkpoint before vocal inference. If the voice backend is missing, follow the setup printed by
`dawg vocals setup`, then resume with the exact `dawg make --from <chart>` command
printed by the failed run. A saved chart reuses its accepted take when available.
`--instrumental` explicitly makes a draft; `--voice synth` selects the older
synthetic singer. Saved scores and their audio assets play without Python.

## References and recreations

Ask to study or recreate a YouTube URL or project audio file. `reference-study`
measures production and timing; `recreate-source` builds an editable private study.
The agent preserves the source vocal and re-sings the actual supplied or
transcribed words with stock `bf_emma`.

The CLI can import an explicitly named external audio file read-only. Agent
imports use project files or existing `/agent read-root add <folder>` access.

The shell entry points are `dawg reference prepare <file-or-YouTube-URL>` and
`dawg reference recreate <prepared-manifest>`. `prepare` prints the manifest path;
pass that exact value to `recreate`. Use `--vocal <file>` for an already separated
vocal, or `--isolated` when the input itself is an isolated vocal. Otherwise the
configured separator supplies the actual vocal artifact. A full mix is never
labeled an isolated vocal.

`recreate --lyrics <file>` accepts timed JSON lines with `start`, `end` and `text`,
and optional `wordCenters`, in source seconds. Without supplied lines, recreation
requires the configured cached Whisper model. `dawg reference setup` describes
the optional dependencies. Source files, lyrics and takes remain project-local.

The result includes editable melody, stock vocal audio, retained accompaniment
stems and aligned source/stock comparison files at matched level. The agent
transcribes and rebuilds accompaniment from those stems. Grid drift and section
similarity are evidence for review, rather than authoritative musical labels.
Pitch, timing, word coverage and tone have separate quality fields. Close pitch
tracking and valid files do not establish an exact recreation.

## Inspect and recover

```sh
dawg workflow list
dawg workflow read original-house
dawg workflow status --json
dawg workflow cancel <job-id>
dawg workflow resume <job-id>
dawg vocals doctor --json
```

Workflow resources ship with the package and resolve outside the contributor
checkout. `workflow start` creates a queued job for a driver or agent; reading,
creating and inspecting a job do not run inference. Resume keeps completed stages
and verified assets, invalidates old callbacks and lets the selected driver
continue. A quality report may mark technical closure complete while word clarity
or tone still needs listening.

```agent
Use workflow_catalog for the versioned original-house/reference-study/recreate-source
instructions and resources. Do not copy private contributor skills into a user's
project. perform_chart instrumental=true commits an explicit early instrumental
draft; sing_chart generates the actual original words; perform_chart then attaches
the accepted take with the same file/name/focused-track identity. Preserve authored
pitch and lower verse register. Project takes do not need a bundledSample entry.
prepare_reference accepts file or url; recreate_reference_vocal retains the source
and re-sings actual timed words with stock bf_emma. Rebuild accompaniment from
retained stems using transcribe_notes and score tools. Keep missing assets, ready
tracks, saved score revisions, buffered PCM and audible revisions distinct. Do not
claim perceptual success from file checks. Pause/seek/pin remain the listener's.
```
