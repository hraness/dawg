import { describe, expect, test } from "bun:test";
import { createScore } from "../../core/score.ts";
import {
  drawerView,
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

  test("PgUp/PgDn page, Home/End min/max, 0 and d reset", () => {
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
    expect(press(state, "d")).toMatchObject({ command: "fx reverb mix 0.3" });
    expect(press(state, "0")).toMatchObject({ command: "fx reverb mix 0.3" });
  });

  test("digits type an exact value; Enter sets it, Esc drops the typing", () => {
    const state: FaderState = { label: "mix" };
    expect(press(state, "0")).toMatchObject({ type: "set" });
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
      title: "Reverb",
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
});
