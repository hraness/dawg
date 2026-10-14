import { expect, test } from "bun:test";
import { TuiApp, frameText, type AppView } from "../tui/app.ts";
import {
  NavigationHistory,
  NAVIGATION_ACTIONS,
  navigationAction,
} from "../tui/navigation.ts";
import { EditMenu, type MenuContext } from "../src/tui/menu.ts";
import { jumpItems, parseJumpChoice } from "../src/tui/jump.ts";
import { scoreFromJSON } from "../core/score.ts";

const view: AppView = {
  score: { trackId: "keys", bpm: 120, notes: [] },
  beat: 0,
};
const context: MenuContext = {
  score: scoreFromJSON({
    tracks: [{ id: "keys", name: "Keys", instrument: "piano" }],
    notes: [],
  }),
  trackId: "keys",
  playing: false,
  grid: "1/16",
  grids: ["1/16"],
  clickOn: false,
  countInBars: 1,
};
function harness() {
  const app = new TuiApp({
    io: { write() {}, columns: () => 80, rows: () => 24 },
    clock: () => 1000,
    capabilities: { colorDepth: "none", unicode: true },
  });
  const render = () => {
    app.render(view, { force: true });
    return frameText(app.frame!);
  };
  return { app, render };
}

test("Jump indexes every track, menu destination, guide and command with explicit intent", () => {
  const items = jumpItems(context);
  expect(items.find((item) => item.label === "Track · Keys")?.detail).toContain(
    "keys",
  );
  expect(items.some((item) => item.label === "Menu · sound")).toBe(true);
  expect(items.some((item) => item.label.startsWith("Guide ·"))).toBe(true);
  expect(items.some((item) => item.label === "Command · tempo")).toBe(true);
  for (const item of items) {
    const choice = parseJumpChoice(item.value);
    expect(choice).toBeDefined();
    if (item.label.startsWith("Command ·")) expect(choice?.kind).toBe("insert");
  }
  expect(parseJumpChoice("bad json")).toBeUndefined();
  expect(
    parseJumpChoice('{"kind":"execute","command":"delete"}'),
  ).toBeUndefined();
  for (const action of NAVIGATION_ACTIONS)
    expect(navigationAction(action.key)).toBe(action.id);
});

test("nested guide and transcript restore picker query, selection and draft cursor", () => {
  const { app, render } = harness();
  app.prompt.handle({ type: "paste", text: "tempo 123" });
  app.prompt.handle("LEFT");
  const draft = app.prompt.snapshot;
  app.openPicker({
    id: "menu",
    title: "menu",
    items: [
      { label: "first", value: "one" },
      { label: "second", value: "two" },
    ],
  });
  app.input("s");
  app.openGuide();
  app.toggleLog();
  expect(app.ui.overlay).toBe("log");
  expect(render()).toContain("LOG · draft saved");
  expect(app.frame?.cursor).toBeUndefined();
  app.backOverlay();
  expect(app.ui.overlay).toBe("guide");
  app.backOverlay();
  expect(app.ui.picker?.id).toBe("menu");
  expect(app.ui.picker?.query).toBe("s");
  expect(app.ui.picker?.items[0]?.value).toBe("two");
  expect(app.prompt.snapshot).toEqual(draft);
});

test("compact prompt and covered editor retain discoverable Jump and Back", () => {
  const app = new TuiApp({
    io: { write() {}, columns: () => 60, rows: () => 24 },
    clock: () => 1000,
    capabilities: { colorDepth: "none", unicode: true },
  });
  app.render(view, { force: true });
  for (const command of ["/jump", "/back", "/menu", "/play", "/guide"])
    expect(
      app.frame!.hits.regions.some(
        ({ target }) => target.kind === "command" && target.command === command,
      ),
    ).toBe(true);
  app.openText("help", ["read here"]);
  app.render(
    { ...view, spend: "a long session status competes with navigation hints" },
    { force: true },
  );
  const text = frameText(app.frame!);
  expect(text).toContain("jump");
  expect(text).toContain("back");
  expect(app.frame!.cursor).toBeUndefined();
});

test("key reader scrolls, blocks paste and leaves the underlying prompt and picker untouched", () => {
  const { app, render } = harness();
  app.prompt.handle({ type: "paste", text: "saved draft" });
  app.openPicker({
    id: "edit",
    title: "edit",
    items: [{ label: "one", value: "one" }],
  });
  app.showKeys(
    "long keys",
    Array.from({ length: 50 }, (_, i) => `binding ${i}`),
  );
  const before = app.prompt.snapshot;
  app.input({ type: "paste", text: "invisible edit" });
  app.input("x");
  app.input("\u001b[F");
  const text = render();
  expect(text).toContain("binding 49");
  expect(app.prompt.snapshot).toEqual(before);
  expect(app.ui.picker?.query).toBeUndefined();
  app.input("\u001b");
  expect(app.ui.keys).toBeUndefined();
  expect(app.ui.picker?.id).toBe("edit");
});

test("paste belongs to the focused search and Escape preserves an unsubmitted prompt", () => {
  const { app } = harness();
  app.prompt.handle({ type: "paste", text: "keep my draft" });
  app.input("\u001b");
  expect(app.prompt.value).toBe("keep my draft");
  app.openPicker({
    id: "names",
    title: "names",
    items: [
      { label: "Keys", value: "keys" },
      { label: "Bass", value: "bass" },
    ],
  });
  app.input({ type: "paste", text: "Bass" });
  expect(app.ui.picker?.query).toBe("Bass");
  expect(app.ui.picker?.items.map((item) => item.value)).toEqual(["bass"]);
  expect(app.prompt.value).toBe("keep my draft");
  app.openText("help", ["read this"]);
  for (const key of ["x", " ", "\r"]) app.input(key);
  app.input({ type: "paste", text: "must not leak" });
  expect(app.prompt.value).toBe("keep my draft");
});

test("location snapshot restores its nested panels and history position after another location", () => {
  const { app } = harness();
  app.prompt.handle({ type: "paste", text: "tempo 100" });
  app.prompt.handle("ENTER");
  app.prompt.handle({ type: "paste", text: "unfinished" });
  app.prompt.handle("UP");
  app.openText("read", ["line"]);
  app.openGuide();
  const saved = app.saveNavigation();
  app.clearSurfaces();
  app.prompt.resetDraft("volume 0.2");
  app.prompt.handle("ENTER");
  app.restoreNavigation(saved);
  expect(app.ui.overlay).toBe("guide");
  app.backOverlay();
  expect(app.ui.overlay).toBe("text");
  app.backOverlay();
  expect(app.ui.overlay).toBeUndefined();
  app.prompt.handle("DOWN");
  expect(app.prompt.value).toBe("volume 0.2");
  app.prompt.handle("DOWN");
  expect(app.prompt.value).toBe("unfinished");
});

test("menu navigation state restores selection independently of committed score", () => {
  const menu = new EditMenu();
  menu.show(context, "sound");
  menu.key("\u001b[B", context);
  const saved = menu.saveNavigation();
  const selected = menu.view(context).index;
  menu.show(context, "project");
  menu.restoreNavigation(saved);
  expect(menu.view(context).index).toBe(selected);
  expect(menu.saveNavigation()).toEqual(saved);
  const history = new NavigationHistory<number>(2);
  history.push(1);
  history.push(2);
  history.push(3);
  expect(history.back()).toBe(3);
  expect(history.back()).toBe(2);
  expect(history.back()).toBeUndefined();
});
