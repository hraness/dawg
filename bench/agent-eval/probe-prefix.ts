/**
 * Prompt-size latency probe: times the first request of a turn with the full
 * tool list against a minimal one, to see whether prefill size matters.
 *   bun bench/agent-eval/probe-prefix.ts --model anthropic/claude-haiku-5.5 --n 4
 */
import { parseArgs } from "node:util";
import { AGENT_SYSTEM_PROMPT } from "../../src/agent/agent.ts";
import { AGENT_TOOLS, chatTools } from "../../src/agent/tools.ts";
import {
  apiClient,
  isApiSelection,
  selectProvider,
} from "../../src/agent/provider.ts";

const { values } = parseArgs({
  options: { model: { type: "string" }, n: { type: "string", default: "4" } },
});
const selection = await selectProvider();
if (!isApiSelection(selection)) throw new Error("needs a key-based provider");
const client = apiClient(selection);
const all = chatTools(AGENT_TOOLS);
const few = all.filter((t) =>
  ["set_tempo", "add_notes", "create_track", "set_rhythm"].includes(
    t.function.name,
  ),
);
const brief = `Composition brief (JSON): {"revision":1,"tempoBpm":120,"meter":"4/4","loopBeats":16,"tracks":[{"id":"bass","instrument":"bass","notes":0}]}`;
for (const [label, tools, system] of [
  ["full", all, AGENT_SYSTEM_PROMPT],
  [
    "min",
    few,
    "You are dawg, a loop composer. Edit the score only by calling tools.",
  ],
] as const) {
  const firsts: number[] = [];
  const totals: number[] = [];
  let cached = 0;
  let input = 0;
  for (let i = 0; i < Number(values.n); i += 1) {
    const start = performance.now();
    let first: number | null = null;
    for await (const e of client.stream(
      {
        model: values.model!,
        messages: [
          { role: "system", content: system },
          { role: "system", content: brief },
          { role: "user", content: `set the tempo to ${90 + i}` },
        ],
        tools,
        maxResponseBytes: 1 << 20,
      },
      AbortSignal.timeout(60_000),
    )) {
      if (first === null && (e.type === "text" || e.type === "tool-delta"))
        first = performance.now() - start;
      if (e.type === "usage") {
        cached += e.cachedInputTokens ?? 0;
        input += e.inputTokens;
      }
    }
    firsts.push(first ?? -1);
    totals.push(performance.now() - start);
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
  console.log(
    `${values.model} ${label}: first ${med(firsts).toFixed(0)} ms, total ${med(totals).toFixed(0)} ms, input ${input} cached ${cached} (${firsts.map((x) => x.toFixed(0)).join(" ")})`,
  );
}
