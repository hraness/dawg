# Durable progress and playback

Jobs save the selected workflow/version, source identities, stages, accepted artifacts,
written revisions, track/section readiness and actual audible-buffer receipts.
Stages name musical work. Only committed score changes count as written progress.

An asset-dependent track cannot be ready while any required artifact is missing,
stale or fails its hash. Planned notes, placeholder vocals and a scheduled render
do not prove audible readiness. Instrumental preview may be labeled ready while
the voice remains waiting. A coherent region has nonempty actual rendered music.

The playback host publishes an audible receipt only after successfully committing
the corresponding buffer. Written and audible revisions remain distinct. Preserve
previous ready audio until the new region covers the current playhead. Human
pause/stop/seek increments the control token so a late callback cannot override it.

Cancellation interrupts owned work and preserves accepted outputs. Explicit resume
reconciles interrupted stages and reuses completed results. Source, configuration,
attempt, epoch and written-revision guards reject stale results. New inference is
not promised to repeat byte-for-byte; replay uses the accepted saved take.
