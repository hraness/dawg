# Agent model eval

dawg's agent edits a structured score through typed tools, so a model does not
have to write audio code or guess file formats; it has to pick the right tool
and fill in musically correct arguments. `bench/agent-eval/` measures how well
cheap, fast models do that, with code graders only (no LLM judge).

## What it runs

- **Real loop, temp project.** Each task creates a temp project with a
  starting score, runs `runAgentTurn` with dawg's real tools (score tools,
  workspace file tools with the real typecheck, a stubbed offline web), and
  grades the resulting score.
- **65 tasks in five tiers.** `single` (22: a four-on-the-floor kick at 128
  BPM, transpose, reverb mix, meter, delay time), `compose` (17: ii-V-I in Bb
  with a walking bass, son and rumba clave, tresillo, an 8-bar trance build
  with a filter ramp, 12-bar blues, dembow, boom bap, Andalusian cadence),
  `files` (10: edits to `song.ts` and `tracks/*/track.ts` through the
  workspace tools), `multi` (8: several edits in one prompt) and `recovery`
  (8: out-of-range values, wrong track names, a broken file edit, a write
  outside the writable scope).
- **Graders are numeric.** They check pitch-class sets, onsets on a grid,
  chord roots on downbeats, automation slopes, tempo, effect parameters and
  that other tracks are unchanged. Rhythms are abstract grids and
  progressions are functional grammar; no melody or recording is copied.
- **Style tasks are not included.** The style engine (`apply_style`) had not
  merged when this ran; add them when it does.

Each run records pass, steps (model requests), tool calls, input, cached and
output tokens, first-token latency, full-turn latency and cost (the
provider-reported charge, else the listed price).

## Running it

```sh
# live: needs a key-based provider (AI Gateway or OpenRouter); keys are never printed
bun bench/agent-eval/cli.ts --models anthropic/claude-haiku-5.5,zai/glm-5.3-flash \
  --reps 1 --tasks all --concurrency 6 --cap 20 \
  --out run.json --transcripts tx/

# merge several runs and print the table below
bun bench/agent-eval/report.ts --out bench/agent-eval/results/2026-10-09.json run.json reps.json

# replay recorded transcripts through the current grader after a grader fix
bun bench/agent-eval/regrade.ts --results run.json --transcripts tx/ --out run.regraded.json
```

`--tasks` takes `all`, a tier, or task ids. `--cap` is a hard USD limit: no
task starts once the running cost reaches it, and `--spent` carries money
spent by earlier invocations.

CI never touches the network. `tasks.test.ts` replays every task's reference
solution (must pass) and a do-nothing answer (must fail);
`recorded.test.ts` replays 20 recorded live transcripts from six models,
covering passes and failures in every tier, and requires the recorded
verdict; `harness.test.ts` covers the clients, percentiles, pricing and the
report.

## Results (2026-10-09, Vercel AI Gateway)

All 65 tasks once per model. Seven models ran 12 tasks (every tier) two more
times, so their latency rows rest on three repetitions of those tasks. The
current default, Claude Opus 5.5, ran a 10-task sample because it costs about
$0.40 a task. "p50 turn" is the wall time of a whole agent turn (every step
and tool call); "first token" is the wait before the first streamed token of
the first step. Provider errors (503s, timeouts) count as failures. "pass"
and the tier columns weight every task equally, so the repeated tasks do not
count three times.

| model                                | pass | single | compose | files | multi | recovery | p50 turn | p95 turn | p50 first token | steps | calls |  $/task | runs |
| ------------------------------------ | ---: | -----: | ------: | ----: | ----: | -------: | -------: | -------: | --------------: | ----: | ----: | ------: | ---: |
| anthropic/claude-opus-5.5            | 100% |   100% |    100% |  100% |  100% |     100% |    9.8 s |   28.3 s |           2.3 s |   2.4 |   2.4 | $0.4076 |   10 |
| anthropic/claude-haiku-5.5           |  97% |    98% |     90% |  100% |  100% |     100% |    4.2 s |   21.5 s |           1.5 s |   2.8 |   2.7 | $0.0099 |   89 |
| deepseek/deepseek-v4-flash           |  96% |    98% |     86% |  100% |  100% |     100% |   12.7 s |   80.4 s |           4.0 s |   2.6 |   2.2 | $0.0032 |   89 |
| google/gemini-3.8-flash              |  94% |    97% |     86% |  100% |  100% |      88% |    9.9 s |   49.8 s |           5.3 s |   2.7 |   2.2 | $0.0301 |   89 |
| zai/glm-5.3-flash                    |  92% |    95% |     82% |  100% |   96% |      88% |    5.7 s |   55.4 s |           2.1 s |   2.6 |   2.1 | $0.0051 |   89 |
| openai/gpt-6-luna                    |  84% |    89% |     71% |  100% |   88% |      75% |    7.7 s |   36.5 s |           2.1 s |   3.3 |   2.6 | $0.0049 |   89 |
| anthropic/claude-haiku-4.5           |  83% |    95% |     53% |  100% |   75% |     100% |    3.1 s |    6.3 s |           0.8 s |   2.3 |   1.7 | $0.0648 |   65 |
| openai/gpt-oss-120b                  |  73% |    98% |     65% |   37% |   79% |      58% |    4.5 s |   21.1 s |           1.3 s |   3.4 |   2.5 | $0.0066 |   89 |
| mistral/mistral-small                |  66% |    86% |     29% |  100% |   63% |      50% |    3.1 s |    8.6 s |           1.3 s |   2.4 |   1.8 | $0.0058 |   65 |
| google/gemini-3.1-flash-lite         |  65% |    73% |     41% |   70% |   63% |      88% |    9.7 s |   12.6 s |           1.2 s |   6.4 |   6.6 | $0.0150 |   65 |
| spacexai/grok-4.1-fast-non-reasoning |  57% |    82% |     18% |   70% |   50% |      63% |    2.3 s |   10.2 s |           0.8 s |   2.9 |   3.2 | $0.0036 |   89 |
| openai/gpt-5.4-nano                  |  51% |    77% |     29% |   40% |   38% |      50% |    6.4 s |   13.6 s |           1.3 s |   3.4 |   3.0 | $0.0024 |   65 |

Total spend for this lane: about $18.50 of the $20 cap ($15.46 in the runs
above, the rest in probes while the harness was built). Raw records, with
per-run tokens, latency and failed checks, are in
`bench/agent-eval/results/2026-10-09.json`.

## Latency pass (2026-10-09, after)

What a turn spent its time on: about 2.5 model requests, and the last one
usually only wrote the closing sentence. Prompt size was not dominant: with
Anthropic caching on, Haiku 5.5 and Grok reach the first token in about the
same time on a minimal prompt as on the full one. GLM-5.3 Flash (no explicit
cache) drops from 2.8 s to 0.7 s on a minimal prompt, so trimming would help
it, but every trim tried lowered its compose pass rate.

Changes:

- **`Done:` ends a parameter edit in one request.** A tempo, mix, effect or
  sound edit whose reply starts with `Done:` beside its calls ends once they
  apply. Steps that write notes, rhythms, chords or structure
  (`CONTENT_TOOLS` in `src/agent/agent.ts`) always get a review step: ending
  those early made Haiku skip its self-check and lose clave and build tasks.
  A longer version of the instruction made GLM-5.3 Flash loop in hidden
  reasoning until the 1 MB response cap on 10 of 75 compose runs; the
  shipped wording keeps the old closing line and adds one optional clause.
- **First-byte timeout and fallback.** A stream that sends no byte for 20 s
  after its headers is retried; Haiku 5.5 then falls back once to GLM-5.3
  Flash.
- **Typed commands never wait on the agent.** A slash command typed during
  a turn runs at once instead of being queued as steering.
- **`/model fast`** picks Haiku 5.5.

Same tasks, same day. Providers drifted between the morning and afternoon
runs (GLM-5.3 Flash compose: 82% in the table above, 73% on unchanged
`main` in the afternoon), so pass rates are compared against `main` re-run
the same afternoon, pooled over every rep.

| model            | tier                    |     before (main, same day) |               after |
| ---------------- | ----------------------- | --------------------------: | ------------------: |
| claude-haiku-5.5 | compose                 |                92/102 (90%) |       121/136 (89%) |
| claude-haiku-5.5 | multi                   |                 22/24 (92%) |         38/40 (95%) |
| claude-haiku-5.5 | single, files, recovery | 98% / 100% / 100% (morning) | 86/88, 40/40, 31/32 |
| glm-5.3-flash    | compose                 |                 37/51 (73%) |         62/85 (73%) |
| glm-5.3-flash    | multi                   |                 20/24 (83%) |         36/40 (90%) |
| glm-5.3-flash    | single, files, recovery |  95% / 100% / 88% (morning) | 84/88, 40/40, 30/32 |

Latency, all 65 tasks twice (after) against the morning table:

| model                            |        pass |     p50 turn | p50 first token |            $/task |
| -------------------------------- | ----------: | -----------: | --------------: | ----------------: |
| claude-opus-5.5 (10-task sample) | 100% → 100% |  9.8 → 8.8 s |     2.3 → 2.2 s |     $0.41 → $0.13 |
| claude-haiku-5.5                 |   97% → 95% |  4.2 → 3.8 s |     1.5 → 1.4 s | $0.0099 → $0.0019 |
| zai/glm-5.3-flash                |   92% → 88% |  5.7 → 4.9 s |     2.1 → 1.8 s | $0.0051 → $0.0047 |
| deepseek-v4-flash                |   96% → 93% | 12.7 → 7.6 s |     4.0 → 2.7 s | $0.0032 → $0.0029 |
| openai/gpt-6-luna                |   84% → 87% |  7.7 → 7.8 s |     2.1 → 2.1 s | $0.0049 → $0.0050 |
| openai/gpt-oss-120b              |   73% → 70% |  4.5 → 3.6 s |     1.3 → 1.2 s | $0.0066 → $0.0056 |
| grok-4.1-fast                    |   57% → 60% |  2.3 → 2.7 s |     0.8 → 0.8 s | $0.0036 → $0.0038 |

Most single edits on Haiku 5.5 now take one request (single and multi tiers: p50 turn 1.8 s, first token 1.2 s). The four models in the last rows ran once per task within the spend
cap (about 60 of 65 tasks); their pass deltas are within one or two tasks
and within the same-day noise shown above. Haiku's cost drop is mostly the
prompt-cache fix landing in `main`. `transpose-bass-whole-step` failed both
final Haiku runs (it double-applied the shift after re-reading the file);
pooled over today it is 4/6, as before (2/3). Spend for this pass: about
$9 of the $10 cap.

**`/model fast` = Haiku 5.5.** It is the fastest model that passes the
non-style tasks about as well as the default: 98% single, 100% files and
recovery, against Opus 5.5's 100% on its sample. Grok 4.1 Fast and Mistral
Small are faster but fail most compose tasks, and GLM-5.3 Flash is slower
at p50 and passes less.

## Findings

- **Small models do well here.** Five models clear 90% on tasks that need
  real theory (clave sides, walking bass on chord tones, filter ramps across
  a build), and four of them cost under a cent a task. The typed tools and
  the composition brief do most of the work: single edits pass at 95% or
  more for every model above 70%.
- **`compose` separates the ladder.** Clave and son patterns, the ii-V-I
  walk and genre grooves are where cheap models fail: they write a correct
  pattern in the wrong phase (2-3 instead of 3-2) or a bass that leaps
  instead of walking. `files` is easy for most models; gpt-oss-120b fails it because
  it usually answers without editing the files at all.
- **Latency is mostly steps, not tokens.** A turn is about 2.5 model
  requests. The fastest correct models finish a single edit in 2 to 4 s;
  long tails (p95) come from models that verify by re-reading files, and
  from provider stalls.
- **Fixed while measuring.** The harness found and this branch fixes: a
  gateway header timeout that killed streams longer than 15 s, Gemini
  rejecting the tool schema (400), an `update_notes` transpose the models
  kept asking for, `set_rhythm` tiling semantics that misled every model,
  and Anthropic prompt caching that was never requested through the
  gateway. Claude costs above were measured before the cache fix; with it,
  later requests in a turn read about 27K tokens from cache, so Claude
  rows overstate cost.
- **Ranked by provider noise too.** Mistral Small and Gemini 3.8 Flash lost
  runs to 503s and 15 s stalls on the day; their pass rates include those.

## Recommendation

- **Default: `anthropic/claude-haiku-5.5`.** 97% pass (Opus 5.5: 100% on a
  10-task sample), p50 turn 4.2 s against 9.8 s, p50 first token 1.5 s
  against 2.3 s, and about $0.01 a task against $0.41: roughly 40 times
  cheaper and twice as fast for three points of pass rate. Keep Opus 5.5
  as the model to switch to for long, open-ended composition.
- **Fast and cheap: `zai/glm-5.3-flash`.** 92% pass, p50 turn 5.7 s, first
  token 2.1 s, $0.005 a task. `deepseek/deepseek-v4-flash` passes more (96%)
  for $0.003 but takes 12.7 s at p50, too slow for interactive edits.
- **Not yet:** the fastest models (Grok 4.1 Fast, 2.3 s; Mistral Small,
  3.1 s) pass only 57% and 66%, failing most `compose` tasks. Rerun this
  benchmark when the style engine lands: `apply_style` should lift exactly
  the tier where they fail.
