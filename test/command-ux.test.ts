import { describe, expect, test } from "bun:test";
import { commandCompletions } from "../src/tui/completion.ts";
import {
  applyChordsCommand,
  defaultChordSettings,
} from "../src/tui/play-chords.ts";
import { TuiApp, frameText, type AppView } from "../tui/app.ts";

const context = {
  tracks: [
    { id: "bass", name: "Electric bass" },
    { id: "kit", name: "Drum kit" },
  ],
  sections: [{ name: "Intro" }, { name: "Second verse" }],
};
const view: AppView = {
  score: {
    trackName: "Bass",
    bpm: 120,
    key: "Am",
    playing: true,
    loopBeats: 8,
    beatsPerBar: 4,
    notes: [],
  },
  beat: 0,
};

function harness(width = 60) {
  const app = new TuiApp({
    io: { write() {}, columns: () => width, rows: () => 24 },
    capabilities: { colorDepth: "truecolor", unicode: true },
    clock: () => 1000,
    reducedMotion: true,
  });
  app.completionSource = (text) => commandCompletions(text, context);
  const render = (extra: Partial<AppView> = {}) => {
    app.render({ ...view, ...extra }, { force: true });
    return app.frame!;
  };
  const type = (text: string) => {
    for (const key of text) app.input(key);
  };
  return { app, render, type };
}

describe("command discovery", () => {
  test("commands and local names rank ahead of descriptive matches", () => {
    expect(commandCompletions("preset", context)[0]?.value).toBe("preset");
    expect(commandCompletions("track bs", context)[0]?.value).toBe(
      "track bass",
    );
    expect(commandCompletions("section jump scvr", context)[0]?.value).toBe(
      "section jump Second verse",
    );
  });

  test("slash play has one keyboard action, distinct from bare transport play", () => {
    const matches = commandCompletions("/play", context).filter(
      (item) => item.value === "/play",
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.label).toBe("/play");
    expect(commandCompletions("play", context)[0]?.value).toBe("play");
  });

  test("every suggested chord performance is accepted by the real parser", () => {
    const choices = commandCompletions("/chords perform ", context);
    expect(choices.length).toBeGreaterThan(0);
    for (const choice of choices)
      expect(
        applyChordsCommand(
          defaultChordSettings(),
          choice.value.replace(/^\/chords\s/u, ""),
        ).ok,
      ).toBe(true);
  });

  test("large pasted and multiline text do not trigger command suggestions", () => {
    expect(commandCompletions("style " + "x".repeat(300), context)).toEqual([]);
    expect(commandCompletions("style\nhouse", context)).toEqual([]);
  });

  test("Tab inserts only; Enter runs exactly the typed text", () => {
    const h = harness();
    h.type("track bs");
    h.render();
    expect(h.app.input("\t").type).toBe("overlay");
    expect(h.app.prompt.value).toBe("track bass ");
    const submitted = h.app.input("\r");
    expect(submitted.type).toBe("action");
    if (submitted.type === "action") {
      expect(submitted.action.kind).toBe("submit");
      if (submitted.action.kind === "submit")
        expect(submitted.action.value).toBe("track bass ");
    }
    h.type("track bs");
    h.render();
    const typed = h.app.input("\r");
    if (typed.type !== "action" || typed.action.kind !== "submit")
      throw new Error("typed command was not submitted");
    expect(typed.action.value).toBe("track bs");
  });

  test("Escape hides the suggestion until text changes, and editing midline stays normal", () => {
    const h = harness();
    h.type("track bs");
    h.render();
    h.app.input("\u001b");
    h.render();
    expect(h.app.ui.completion).toBeUndefined();
    h.type("s");
    h.render();
    expect(h.app.ui.completion).toBeDefined();
    h.app.input("\u001b[D");
    h.render();
    expect(h.app.ui.completion).toBeUndefined();
    expect(h.app.prompt.value).toBe("track bss");
  });

  test("command suggestions stay visible and selectable while playing keys", () => {
    const h = harness();
    h.type("track bs");
    const frame = h.render({
      play: {
        range: "C4–F5",
        velocity: 100,
        armed: false,
        recording: false,
        replace: false,
        click: false,
        sustain: false,
        grid: "grid 1/16",
        keys: [],
        chordMode: "off",
        degrees: false,
      },
    });
    expect(frameText(frame)).toContain("Commands");
    expect(
      frame.hits.regions.some((hit) => hit.target.kind === "completion-row"),
    ).toBe(true);
    h.app.input("\t");
    expect(h.app.prompt.value).toBe("track bass ");
  });
});

describe("picker and mouse parity", () => {
  test("typeahead matches letters previously reserved for vim navigation", () => {
    const h = harness();
    h.app.openPicker({
      id: "sounds",
      title: "Sounds",
      items: [
        { label: "Granular swarm", value: "grain" },
        { label: "Jungle kit", value: "jungle" },
      ],
    });
    h.type("jk");
    expect(h.app.picker?.query).toBe("jk");
    expect(h.app.picker?.items.map((item) => item.value)).toEqual(["jungle"]);
    h.app.input("\u001b[B");
    h.app.input("\u007f");
    expect(h.app.picker?.query).toBe("j");
    h.app.input("\u001b");
    expect(h.app.picker?.items).toHaveLength(2);
  });

  test("a long wrapped label has the same mouse target on every continuation", () => {
    const h = harness();
    h.app.openPicker({
      id: "sounds",
      title: "Sounds",
      items: [
        {
          label:
            "Granular texture with a very long descriptive phrase that must wrap clearly",
          value: "grain",
          topic: "sound",
        },
        { label: "Kit", value: "kit" },
      ],
    });
    const frame = h.render();
    const region = frame.hits.regions.find(
      (hit) => hit.target.kind === "picker-row" && hit.target.index === 0,
    )!;
    expect(region.height).toBeGreaterThan(1);
    for (let row = 0; row < region.height; row++)
      expect(frame.hits.at(region.x + 4, region.y + row)?.target).toEqual({
        kind: "picker-row",
        index: 0,
      });
    expect(frameText(frame)).toContain("must wrap clearly");
    expect(
      frame.hits.regions.some((hit) => hit.target.kind === "command"),
    ).toBe(false);
  });

  test("semantic category symbols preserve the independent current-item mark", () => {
    const h = harness();
    h.app.openPicker({
      id: "sounds",
      title: "Sounds",
      items: [
        { label: "Grand", value: "grand", topic: "sound", current: true },
      ],
    });
    const text = frameText(h.render());
    expect(text).toContain("♪");
    expect(text).toContain("●");
  });

  test("play controls show both the note mode and key mapping, including at 60 columns", () => {
    const h = harness();
    const play = {
      range: "C4–F5",
      velocity: 100,
      armed: false,
      recording: false,
      replace: false,
      click: false,
      sustain: false,
      grid: "grid 1/16",
      keys: [],
      chordMode: "off" as const,
      degrees: true,
    };
    const frame = h.render({ play });
    expect(frameText(frame)).toContain("✓ Notes");
    expect(frameText(frame)).toContain("✓ Scale");
    expect(
      frame.hits.regions.some(
        (hit) =>
          hit.target.kind === "command" && hit.target.command === "/play off",
      ),
    ).toBe(true);
    expect(
      frameText(
        h.render({ play: { ...play, chordMode: "auto", degrees: false } }),
      ),
    ).toContain("✓ Chords");
    const sounds = h.render({ play: { ...play, sounds: true } });
    expect(frameText(sounds)).not.toContain("Chromatic");
    expect(
      sounds.hits.regions.some(
        (hit) => hit.target.kind === "play-key" && hit.target.key === "r",
      ),
    ).toBe(true);
  });

  test("the action shelf and scene strip expose exact painted mouse targets", () => {
    const h = harness();
    const frame = h.render({
      arrange: {
        bars: 8,
        sections: [
          { name: "Intro", startBar: 0, bars: 4 },
          { name: "Verse", startBar: 4, bars: 4 },
        ],
      },
    });
    const shelf = frame.hits.regions.filter(
      (hit) => hit.target.kind === "scene-step",
    );
    expect(shelf.map((hit) => hit.target)).toEqual([
      { kind: "scene-step", direction: -1 },
      { kind: "scene-step", direction: 1 },
    ]);
    for (const hit of shelf)
      expect(frame.hits.at(hit.x, hit.y)?.target).toEqual(hit.target);
    expect(
      frame.hits.regions.some(
        (hit) => hit.target.kind === "scene" && hit.target.name === "Verse",
      ),
    ).toBe(true);
    h.app.openText("Output", ["Results"]);
    const overlay = h.render();
    expect(
      overlay.hits.regions.some((hit) => hit.target.kind === "scene-step"),
    ).toBe(false);
  });
});
