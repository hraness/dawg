# Project-local reference reconstruction

`prepareReference()` accepts a project audio file or a YouTube URL. URL ingestion
uses the existing `download_audio` result; separation uses `split_stems`' returned
paths. A full mix must be separated before it can supply vocal performance
controls. A caller may instead provide an aligned isolated vocal, or explicitly
identify the selected file as a vocal. Preparation preserves the original input,
the isolated vocal and available accompaniment stems in an immutable project-local
artifact, with SHA-256 identities.

The CLI accepts one explicitly named external audio file (including `--vocal`)
without a manual copy. It resolves and opens that regular file read-only, checks
the 500 MiB/600 second limits, then atomically admits immutable hashed bytes under
`tracks/<track>/downloads/reference-<sha256>/`. It never writes beside the source
or changes read permissions. Agent calls can import external audio only from the
human-configured workspace `readRoots`; otherwise use `/agent read-root add
<folder>` or the explicit CLI route. Project-relative inputs keep their existing
resolution behavior.

External admission uses the installed `ffprobe` with file-only protocols and a
bounded self-contained audio format list: WAV, AIFF, MP3, FLAC, Ogg/Opus, MP4/M4A,
AAC, AC3 and Matroska/WebM. Preparation uses the existing checked `ffmpeg` backend
to normalize accepted formats to 24 kHz mono PCM16. No codecs or tools download
implicitly. Accepted editable score files use the standard `track.loop/v1`
envelope and can be passed to DAWG's import/render paths.

The existing media analysis supplies beat evidence. A fitted grid records observed
beat times, fixed-tempo residual and tempo drift; its first detected beat is not a
verified downbeat. WORLD extracts continuous pitch, broad dynamics and a draft
monophonic melody. Four-bar energy/pitch similarity suggests repeat labels, whose
musical function remains unverified. The JSON melody score is editable; rebuild
accompaniment from the retained stems with the existing `transcribe_notes` tools.

`recreateReference()` takes the accepted manifest and optional timed actual lyrics
(`[{start,end,text,wordCenters?}]`, seconds). Without supplied lyrics it uses
`whisper-cli` and an already cached English model. Set
`DAWG_REFERENCE_WHISPER_MODEL` to the local model; no download happens implicitly.
The automatic transcript and inferred word times remain project-local editable
evidence. A line lasts at most 20 seconds; source windows last at most 600 seconds
and the editable score retains DAWG's 256 bar limit.

The Python backend uses the adjacent pinned SciPy requirement and the installed
stock-vocal helper closure under `src/vocals/python`. Select the same Python with
`DAWG_REFERENCE_PYTHON` or `DAWG_VOCAL_PYTHON`; `referenceSetup()` prints setup
requirements. The Kokoro weights and `bf_emma` voice are verified against the
stock helper's pinned revision and SHA-256 values. Generation is cache-only.

Stock TTS supplies every generated spectral envelope and waveform. Bounded
pitch-invariant spectral DTW and chronological word anchors align it to source
continuous F0 and broad dynamics. Source audio is never mixed into `stock.wav`.
The source remains separately available for comparison. Two aligned comparison
WAVs have the same sample count and are matched over active vocal RMS, with gain
receipts. The generated score includes a real pinned stock-vocal clip.

Pitch agreement, word clarity, timing, tone and file integrity are separate
findings. The acoustic report includes pitch error and uncovered voiced time.
Word clarity remains unverified until a listening or independent word check is
performed. Unknown wordless regions are reported and remain empty; the system
does not invent lyrics. A file audit does not establish an exact performance
match, and this helper does not rebuild a multitracked instrumental by itself.

Completed stages are accepted by atomic directory rename and verified before
reuse. Cancellation removes only the current staging directory and retains
accepted preparation and prior takes. An interrupted synthesis restarts from
the accepted preparation; accepted complete takes replay without inference.
No public catalog, original project, demo or source recording is modified.
