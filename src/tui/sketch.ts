/**
 * One-line response sketches for the focused menu row: a filter curve for
 * a cutoff, the envelope shape for attack/decay/sustain/release, and the
 * position inside a wavetable. Sixteen cells, so they sit beside the row's
 * note at 80 columns. Pure and cheap: they run once per menu view.
 */

const CELLS = 16;
const LEVELS = "▁▂▃▄▅▆▇█";

/** The parameter a menu command sets: `fx filter cutoff 800` → cutoff. */
export function commandParam(command: string): string | undefined {
  const words = command.trim().split(/\s+/);
  if (words.length < 2) return undefined;
  const key = words.at(-2)!.toLowerCase();
  return /^[a-z][a-z0-9]*$/.test(key) ? key : undefined;
}

/** Low- or high-pass response over 20 Hz..20 kHz on a log axis. */
export function filterSketch(hz: number, highpass = false): string {
  const at = Math.round(
    ((CELLS - 1) * Math.log(Math.max(20, Math.min(20_000, hz)) / 20)) /
      Math.log(1000),
  );
  let out = "";
  for (let cell = 0; cell < CELLS; cell += 1) {
    const past = highpass ? at - cell : cell - at;
    out += past < 0 ? "▇" : past === 0 ? "▅" : past === 1 ? "▂" : "▁";
  }
  return out;
}

/** ADSR amplitude over time; sustain is held for a quarter of the rest. */
export function envelopeSketch(
  attack: number,
  decay: number,
  sustain: number,
  release: number,
): string {
  const a = Math.max(0, attack);
  const d = Math.max(0, decay);
  const r = Math.max(0, release);
  const s = Math.max(0, Math.min(1, sustain));
  const hold = Math.max(0.05, 0.25 * (a + d + r));
  const total = a + d + hold + r;
  let out = "";
  for (let cell = 0; cell < CELLS; cell += 1) {
    const t = ((cell + 0.5) / CELLS) * total;
    const amp =
      t < a
        ? t / a
        : t < a + d
          ? 1 - ((t - a) / d) * (1 - s)
          : t < a + d + hold
            ? s
            : r > 0
              ? s * (1 - (t - a - d - hold) / r)
              : 0;
    out += LEVELS[Math.round(Math.max(0, Math.min(1, amp)) * 7)]!;
  }
  return out;
}

/** A marker at `value` in min..max. */
export function positionSketch(value: number, min = 0, max = 1): string {
  const span = max - min || 1;
  const at = Math.round(
    (CELLS - 1) * Math.max(0, Math.min(1, (value - min) / span)),
  );
  return "─".repeat(at) + "●" + "─".repeat(CELLS - 1 - at);
}

const ENVELOPE = new Set(["attack", "decay", "sustain", "release"]);

/**
 * The sketch for a focused number row, or undefined when it has none.
 * `valueOf` reads sibling rows by parameter (the other envelope stages);
 * `filterType` is the filter's type row (a band-pass draws no sketch).
 */
export function sketchFor(
  command: string,
  value: number,
  valueOf: (param: string) => number | undefined,
  filterType = "lpf",
): string | undefined {
  const param = commandParam(command);
  if (!param) return undefined;
  if (param === "cutoff")
    return filterType === "hpf"
      ? filterSketch(value, true)
      : filterType === "lpf"
        ? filterSketch(value)
        : undefined;
  if (param === "lpf") return filterSketch(value);
  if (param === "hpf") return filterSketch(value, true);
  if (param === "wt") return positionSketch(value);
  if (ENVELOPE.has(param)) {
    const stage = (name: string, fallback: number) =>
      name === param ? value : (valueOf(name) ?? fallback);
    return envelopeSketch(
      stage("attack", 0.01),
      stage("decay", 0.1),
      stage("sustain", 0.7),
      stage("release", 0.2),
    );
  }
  return undefined;
}
