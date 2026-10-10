import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  detentLabel,
  detentSnap,
  detentsFor,
  drawerView,
  faderCommand,
  stagedBadge,
  faderKeyPress,
  faderPosition,
  faderSetPosition,
  faderStep,
  faderValueAt,
  type FaderNumber,
  type FaderSpec,
  type FaderState,
} from "./fader.ts";
import { EditMenu, type MenuContext } from "./menu.ts";
import { fitHint } from "../../tui/grammar.ts";

const mix: FaderNumber = {
  kind: "number",
  label: "mix",
  value: 0.5,
  min: 0,
  max: 1,
  step: (value, direction) =>
    Math.round((value + direction * 0.05) * 100) / 100,
  format: (value) => value.toFixed(2),
  command: (value) => `fx reverb mix ${value}`,
  parse: (text) => {
    const value = Number(text);
    return Number.isFinite(value) && value >= 0 && value <= 1
      ? `fx reverb mix ${value}`
      : undefined;
  },
  reset: "fx reverb mix 0.3",
};
const cutoff: FaderNumber = {
  ...mix,
  label: "cutoff",
  value: 1000,
  min: 20,
  max: 20000,
  step: (value, direction) =>
    Math.round(value * (direction > 0 ? 1.1 : 1 / 1.1)),
  format: (value) => `${Math.round(value)} Hz`,
  command: (value) => `fx filter cutoff ${value}`,
};
const type: FaderSpec = {
  kind: "choice",
  label: "type",
  value: "lpf",
  options: ["lpf", "hpf", "bpf"],
  command: (option) => `fx filter type ${option}`,
};
const fields: FaderSpec[] = [type, cutoff, mix];
const open = { dirty: false, audition: true };
const dirty = { dirty: true, audition: true };

function press(state: FaderState, key: string, options = open) {
  return faderKeyPress(state, fields, key, options);
}

describe("fader keys", () => {
  test("arrows and −/+ step; Shift and [ ] are coarse and fine", () => {
    const state: FaderState = { label: "mix" };
    expect(press(state, "\u001b[C")).toEqual({
      type: "set",
      command: "fx reverb mix 0.55",
      key: "fader:mix",
    });
    expect(press(state, "-")).toMatchObject({ command: "fx reverb mix 0.45" });
    expect(press(state, "+")).toMatchObject({ command: "fx reverb mix 0.55" });
    expect(press(state, "\u001b[1;2C")).toMatchObject({
      command: "fx reverb mix 0.75",
    });
    expect(press(state, "]")).toMatchObject({ command: "fx reverb mix 0.505" });
    expect(press(state, "[")).toMatchObject({ command: "fx reverb mix 0.495" });
  });

  test("PgUp/PgDn page, Home/End min/max, x d and Delete reset", () => {
    const state: FaderState = { label: "mix" };
    expect(press(state, "\u001b[5~")).toMatchObject({
      command: "fx reverb mix 1",
    });
    expect(press(state, "\u001b[6~")).toMatchObject({
      command: "fx reverb mix 0",
    });
    expect(press(state, "\u001b[H")).toMatchObject({
      command: "fx reverb mix 0",
    });
    expect(press(state, "\u001b[F")).toMatchObject({
      command: "fx reverb mix 1",
    });
    expect(press(state, "x")).toMatchObject({ command: "fx reverb mix 0.3" });
    expect(press(state, "d")).toMatchObject({ command: "fx reverb mix 0.3" });
    expect(press(state, "\u001b[3~")).toMatchObject({
      command: "fx reverb mix 0.3",
    });
  });

  test("digits type an exact value; Enter sets it, Esc drops the typing", () => {
    const state: FaderState = { label: "mix" };
    // `0` starts typing (it no longer resets).
    expect(press(state, "0")).toEqual({ type: "handled" });
    expect(state.typing).toBe("0");
    expect(press(state, ".")).toEqual({ type: "handled" });
    expect(state.typing).toBe("0.");
    press(state, "8");
    expect(press(state, "\r")).toMatchObject({
      command: "fx reverb mix 0.8",
    });
    expect(state.typing).toBeUndefined();
    press(state, "7");
    expect(press(state, "\u001b")).toEqual({ type: "handled" });
    expect(state.typing).toBeUndefined();
  });

  test("Tab / ↑↓ move between related params and wrap", () => {
    const state: FaderState = { label: "cutoff" };
    press(state, "\t");
    expect(state.label).toBe("mix");
    press(state, "\t");
    expect(state.label).toBe("type");
    press(state, "\u001b[A");
    expect(state.label).toBe("mix");
    press(state, "\u001b[Z");
    expect(state.label).toBe("cutoff");
  });

  test("Enter keeps and Esc reverts staged edits; with none they close", () => {
    const state: FaderState = { label: "mix" };
    expect(press(state, "\r")).toEqual({ type: "close" });
    expect(press(state, "\u001b")).toEqual({ type: "close" });
    expect(press(state, "\r", dirty)).toEqual({ type: "keep" });
    expect(press(state, "\u001b", dirty)).toEqual({ type: "revert" });
  });

  test("a choice is a segmented selector: arrows, numbers, ends", () => {
    const state: FaderState = { label: "type" };
    expect(press(state, "\u001b[C")).toMatchObject({
      command: "fx filter type hpf",
    });
    expect(press(state, "\u001b[D")).toEqual({ type: "handled" });
    expect(press(state, "3")).toMatchObject({ command: "fx filter type bpf" });
    expect(press(state, "\u001b[F")).toMatchObject({
      command: "fx filter type bpf",
    });
  });

  test("space / a / c are audition keys", () => {
    const state: FaderState = { label: "mix" };
    expect(press(state, " ")).toEqual({ type: "audition", key: "loop" });
    expect(press(state, "a")).toEqual({ type: "audition", key: "ab" });
  });
});

describe("fader positions", () => {
  test("linear ranges map straight; wide positive ranges map on a log scale", () => {
    expect(faderPosition(mix, 0.25)).toBeCloseTo(0.25);
    expect(faderPosition(cutoff, 20)).toBe(0);
    expect(faderPosition(cutoff, 20000)).toBe(1);
    expect(faderPosition(cutoff, 632)).toBeCloseTo(0.5, 1);
    expect(faderValueAt(mix, 0.5)).toBeCloseTo(0.5);
    expect(faderValueAt(cutoff, 0)).toBe(20);
    expect(faderValueAt(cutoff, 1)).toBe(20000);
  });

  test("clicks and drags set values; [−][+] step; options pick", () => {
    const state: FaderState = { label: "type" };
    expect(faderSetPosition(state, mix, 1)).toMatchObject({
      command: "fx reverb mix 1",
    });
    expect(state.label).toBe("mix");
    expect(faderStep(state, mix, -1)).toMatchObject({
      command: "fx reverb mix 0.45",
    });
    expect(faderStep(state, type, 1)).toMatchObject({
      command: "fx filter type hpf",
    });
    expect(faderSetPosition(state, type, 1)).toMatchObject({
      command: "fx filter type bpf",
    });
  });
});

describe("drawer view", () => {
  test("shows staged beside committed and the focused field", () => {
    const staged = [type, { ...mix, value: 0.8 }];
    const view = drawerView({ label: "mix" }, staged, [type, mix], {
      title: "reverb",
      dirty: true,
    });
    expect(view.focus).toBe(1);
    const field = view.fields[1]!;
    expect(field.kind).toBe("number");
    if (field.kind !== "number") return;
    expect(field.text).toBe("0.80");
    expect(field.committed).toBe("0.50");
    expect(field.position).toBeCloseTo(0.8);
    expect(field.committedPosition).toBeCloseTo(0.5);
  });
});

describe("menu → fader fields", () => {
  const ctx = (): MenuContext => ({
    score: createScore({
      tempoBpm: 120,
      bars: 2,
      tracks: [{ id: "keys", name: "keys", instrument: "piano" }],
      notes: [],
    }),
    trackId: "keys",
    playing: false,
    grid: "1/16",
    grids: ["1/16"],
    clickOn: false,
    countInBars: 1,
  });

  test("`fx filter` opens the filter's params as stacked faders", () => {
    const menu = new EditMenu();
    const label = menu.showFader(ctx(), "fx filter");
    expect(label).toBe("cutoff");
    const labels = menu.faderFields(ctx()).map((field) => field.label);
    expect(labels).toContain("cutoff");
    expect(labels).toContain("resonance");
    expect(labels).toContain("type");
  });

  test("`fx reverb mix`, `volume` and `pan` focus that param", () => {
    const menu = new EditMenu();
    expect(menu.showFader(ctx(), "fx reverb mix")).toBe("mix");
    expect(new EditMenu().showFader(ctx(), "volume")).toBe("volume");
    expect(new EditMenu().showFader(ctx(), "/pan")).toBe("pan");
    expect(new EditMenu().showFader(ctx(), "fx nope")).toBeUndefined();
  });

  test("Mix › master number rows are faders with finite ranges", () => {
    const menu = new EditMenu();
    const context = ctx();
    menu.show(context, "master");
    const numbers = menu
      .nodes(context)
      .filter((node) => node.kind === "number")
      .map((node) => node.label);
    expect(numbers.length).toBeGreaterThan(0);
    const fields = menu.faderFields(context);
    for (const label of numbers) {
      const field = fields.find((candidate) => candidate.label === label);
      expect(field?.kind).toBe("number");
      if (field?.kind === "number") {
        expect(Number.isFinite(field.min)).toBe(true);
        expect(Number.isFinite(field.max)).toBe(true);
        expect(field.min).toBeLessThan(field.max);
      }
    }
  });
});

describe("fader detents", () => {
  const volume: FaderNumber = {
    ...mix,
    label: "volume",
    value: 0.9,
    step: (value, direction) =>
      Math.round((value + direction * 0.01) * 1000) / 1000,
    format: (value) => `${value} · ${(20 * Math.log10(value)).toFixed(1)} dB`,
    command: (value) => `volume ${value}`,
  };
  const pan: FaderNumber = {
    ...mix,
    label: "pan",
    value: 0.1,
    min: -1,
    max: 1,
    step: (value, direction) =>
      Math.round((value + direction * 0.05) * 100) / 100,
    format: (value) => (value === 0 ? "center" : String(value)),
    command: (value) => `pan ${value}`,
  };
  const tempo: FaderNumber = {
    ...mix,
    label: "tempo",
    value: 120,
    min: 20,
    max: 300,
    step: (value, direction) => value + direction,
    format: (value) => `${value} BPM`,
    command: (value) => `tempo ${value}`,
  };

  test("each kind of row finds its detents from its command", () => {
    expect(detentsFor(volume)).toEqual([1]);
    expect(detentsFor(pan)).toEqual([0]);
    expect(detentsFor(tempo)).toBe("integer");
    expect(detentsFor(mix)).toEqual([0, 0.5, 1]);
    const octaves = detentsFor(cutoff) as readonly number[];
    expect(octaves).toContain(440);
    expect(octaves).toContain(27.5);
    expect(detentsFor({ ...mix, command: (v) => `fx delay time ${v}` })).toBe(
      undefined,
    );
  });

  test("a value within 2% snaps; further away it does not", () => {
    expect(detentSnap(volume, 0.985)).toBe(1);
    expect(detentSnap(volume, 0.95)).toBeUndefined();
    expect(detentSnap(pan, 0.03)).toBe(0);
    expect(detentSnap(mix, 0.51)).toBe(0.5);
    expect(detentSnap(tempo, 120.4)).toBe(120);
    expect(detentSnap(cutoff, 445)).toBe(440);
    // On the detent already: nothing to do.
    expect(detentSnap(mix, 0.5)).toBeUndefined();
  });

  test("a key step catches a detent it jumps over, and leaves it freely", () => {
    const state: FaderState = { label: "pan" };
    const at = { ...pan, value: 0.03 };
    expect(faderStep(state, at, -1)).toMatchObject({ command: "pan 0" });
    expect(state.flash).toBe("pan");
    const on = { ...pan, value: 0 };
    expect(faderStep({ label: "pan" }, on, 1)).toMatchObject({
      command: "pan 0.05",
    });
    expect(faderStep({ label: "pan" }, on, -1)).toMatchObject({
      command: "pan -0.05",
    });
  });

  test("fine steps skip detents", () => {
    const state: FaderState = { label: "volume" };
    const near = { ...volume, value: 0.995 };
    expect(faderStep(state, near, 1, "fine")).toMatchObject({
      command: "volume 0.996",
    });
    expect(state.flash).toBeUndefined();
    expect(faderStep(state, near, 1)).toMatchObject({ command: "volume 1" });
    expect(state.flash).toBe("volume");
  });

  test("a drag near 0 dB lands on 1 and flashes for one view", () => {
    const state: FaderState = { label: "volume" };
    expect(faderSetPosition(state, volume, 0.99)).toMatchObject({
      command: "volume 1",
    });
    const view = drawerView(state, [{ ...volume, value: 1 }], [volume], {
      title: "Mix",
      dirty: true,
    });
    const field = view.fields[0]!;
    expect(field.kind === "number" && field.flash).toBe("0 dB");
    const again = drawerView(state, [{ ...volume, value: 1 }], [volume], {
      title: "Mix",
      dirty: true,
    });
    expect(again.fields[0]!.kind === "number" && again.fields[0]!.flash).toBe(
      undefined,
    );
  });

  test("detent labels and the staged badge", () => {
    expect(detentLabel(volume, 1)).toBe("0 dB");
    expect(detentLabel(pan, 0)).toBe("center");
    expect(stagedBadge(1)).toBe(
      "A/B: 1 change staged · enter keep · esc revert",
    );
    expect(stagedBadge(3)).toStartWith("A/B: 3 changes staged");
    const view = drawerView({ label: "mix" }, [mix], [mix], {
      title: "t",
      dirty: true,
    });
    expect(view.badge).toBe("A/B: 1 change staged · enter keep · esc revert");
  });

  test("the hint keeps enter keep and x reset at 80 columns", () => {
    const view = drawerView({ label: "mix" }, [mix], [mix], {
      title: "t",
      dirty: false,
    });
    // The drawer fits its hint into the width less its frame (tui/drawer.ts).
    const fitted = fitHint(view.hint, 80 - 6);
    for (const part of ["←→ adjust", "enter keep", "x reset", "esc revert"])
      expect(fitted).toContain(part);
  });

  test("a field that cannot stage says it applies at once", () => {
    expect(faderCommand(mix)).toBe("fx reverb mix 0.5");
    const view = drawerView({ label: "mix" }, [mix], [mix], {
      title: "t",
      dirty: false,
      atOnce: true,
    });
    const fitted = fitHint(view.hint, 80 - 6);
    expect(fitted).toContain("applies at once");
    expect(fitted).not.toContain("enter keep");
    expect(fitted).not.toContain("esc revert");
    expect(fitted).toContain("x reset");
  });
});
