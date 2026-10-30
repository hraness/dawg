---
name: original-house
metadata:
  version: 1.0.0
description: Write an original, editable house-hyperpop song with project-local stock vocals and measured mix passes.
---

# Write an original house song

Use this workflow for a new song. For production research, select `reference-study`;
for a requested private recreation, select `recreate-source`. Run only the workflow
the person selected. The catalog declares its required runtime capabilities.

Read [the house profile](../references/house.md), [vocal guidance](../references/vocals.md),
[readiness](../references/readiness.md) and [source use](../references/source-use.md).
Read [the chart format](../references/chart-format.md), [schema](../chart.schema.json)
and [small original example](../examples/original.chart.json) before authoring a chart.

1. Save a project-local plan: a concrete image, feeling, original words, singable hook,
   speech-shaped melody and a varied form. Apply `house-v1.json` as the shared policy.
   Use one diatonic major scale, lower conversational verses, a lifting chorus and
   an energetic groove. Choose a different combination of groove, register and lead
   from the recent songs; a single tempo template is insufficient.
2. Commit bounded musical batches to the user's score. Make a coherent early region
   playable while composing later sections. Show actual committed track/section
   progress. Label an instrumental draft honestly while the vocal prepares.
3. Generate the original words with stock British `bf_emma`. Save vocal specs,
   chosen takes, hashes, slices and backend provenance inside this project. Protect
   consonants and held endings. Revise an original line if repeated takes remain
   unclear. Keep clean words above competing chops and doubles.
4. Arrange the song by hand or through validated score operations. Develop repeats,
   leave vocal rests, answer them with instruments, move filters by section, and
   add meaningful dropouts, fills and a changed final chorus. Keep pitched notes
   diatonic. Apply distortion and formant tricks to non-word chops rather than lead words.
5. Render and compare full/solo/rest at matched loudness. Check word retention,
   vocal masking, energy arc, clipping, held tails and output integrity independently.
   Use the profile's intelligibility gates; taste scoring cannot override lost words.
   Save repairs and accepted A/B checkpoints rather than discarding good takes.
6. Export the accepted project-local song and its asset closure. Include technical
   evidence and honest limitations. Generating a user's song never edits the app's
   source, demo registry, bundled sample catalog or release history.

Preserve user pause, stop, seek and pinned inspection throughout. A completed file
audit does not establish a perceptual-quality pass or the identity of a real singer.

## Installed agent tool sequence

1. `workflow_catalog {workflowId:"original-house"}` reads this workflow; use its
   `resource` argument for the chart resources above. `workflow_create` creates the
   selected durable job. `workflow_stage` starts each declared stage and returns a
   ticket; progress/completion/failure use that exact ticket.
2. Author the chart with `write_file` in the user's project, for example
   `songs/current/chart.json`. The chart describes the original musical decisions,
   not a request to copy an existing demo. Save it before vocal inference.
3. Call `perform_chart {file:"songs/current/chart.json",name:"lead",instrumental:true}`
   for an early editable instrumental draft. It explicitly mutes vocal placeholders.
   Record the host's committed revision with `workflow_written`, distinguishing
   ready instrumental tracks from vocals waiting on their assets.
4. Call `sing_chart {file:"songs/current/chart.json",name:"lead"}` to generate the
   actual original words with stock bf_emma. Accepted chart takes use `tracks/vocals`
   independently of the currently inspected or focused track.
5. Call `perform_chart {file:"songs/current/chart.json",name:"lead"}` to attach the
   accepted take. This step uses the cached book and does not silently run inference
   or replace a missing take with synth filler. Record its committed score revision,
   accepted asset identities and updated readiness in the job.
6. `workflow_preview {jobId,range:{from,to},trackIds}` explicitly asks the host for a
   real coherent audio buffer. The host owns autoplay and human transport priority.
   Complete the declared verification/export stages only for the work actually done;
   report unassessed perceptual dimensions independently of technical output checks.

From a shell, `dawg make "a creative brief"` follows the stock vocal route and saves
its authored chart and instrumental checkpoint. `dawg make --from <saved-chart>`
resumes without paying a model to rewrite the song. Explicit `--voice synth` or
`--instrumental` requests a labeled offline draft rather than a stock vocal take.
The CLI records immutable, attempt-specific chart checkpoints such as
`songs/<job-id>/chart-e0-a1.json`. Resume with the exact printed `--from` path or the
job's accepted `chart` artifact path. A cancelled provider's late output cannot
replace that accepted chart or block a successor attempt. The manually authored
`songs/current/chart.json` paths above are examples chosen by the author.
