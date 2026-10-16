/** Input-to-visible-frame latency in an arranged demo, with audio disabled. */
import { open } from "./pty.ts";
import { metric, type Metric } from "./stats.ts";

/**
 * Measure synchronized terminal frames, not the test-only settled-state OSC.
 * Different idle gaps exercise input just after a frame and between heartbeats.
 */
export async function interactiveInput(samples = 24): Promise<Metric[]> {
  const session = await open({
    cols: 120,
    rows: 36,
    env: { DAWG_REDUCED_MOTION: "1" },
  });
  const promptHas = (text: string) => (screen: string) =>
    screen
      .split("\n")
      .slice(-4)
      .some((line) => line.includes(text));
  try {
    await session.until((screen) => screen.includes(" NOW "), "prompt");
    session.send("/demo glass-garden\r");
    await session.until(
      (screen) => screen.includes("Glass Garden"),
      "arranged demo",
    );
    const results: Metric[] = [];
    for (const delay of [0, 10, 20, 100]) {
      const times: number[] = [];
      for (let index = 0; index < samples + 4; index += 1) {
        if (delay > 0) await Bun.sleep(delay);
        const started = session.send("/stl");
        const shown = await session.until(promptHas("stl"), "typed prompt");
        if (index >= 4) times.push(shown - started);
        session.send("\u007f".repeat(4));
        await session.until(promptHas("describe a change"), "empty prompt");
      }
      results.push(
        metric(
          `input.visible.${delay}`,
          `prompt burst → visible frame, ${delay} ms idle`,
          times,
        ),
      );
    }
    return results;
  } finally {
    await session.close();
  }
}
