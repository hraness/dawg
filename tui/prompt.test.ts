import { expect, test } from "bun:test";
import {
  applyPromptKey,
  createPromptState,
  PromptModel,
  renderPrompt,
  wrapPrompt,
} from "./prompt";

test("wrapPrompt preserves logical newlines and bounded visual rows", () => {
  const state = createPromptState("abcdef\nxy", "steer", {
    width: 3,
    maxLines: 4,
    maxChars: 20,
  });
  expect(wrapPrompt(state, 3).map((line) => line.text)).toEqual([
    "abc",
    "def",
    "xy",
  ]);
  expect(
    renderPrompt(state, { width: 3, maxVisualRows: 3, prefix: "> " }),
  ).toEqual(["> abc", "  def", "  xy▌"]);
});

test("newlines, paste, and limits stay bounded", () => {
  let state = createPromptState("", "steer", {
    width: 8,
    maxLines: 2,
    maxChars: 9,
  });
  state = applyPromptKey(
    state,
    { type: "paste", text: "one\ntwo\nthree" },
    { width: 8, maxLines: 2, maxChars: 9 },
  ).state;
  expect(state.text).toBe("one\ntwo");
  expect(state.text.split("\n")).toHaveLength(2);
  expect(state.text.length).toBeLessThanOrEqual(9);
});

test("vertical movement follows wrapped rows and submit clears the draft", () => {
  let state = createPromptState("abcdef", "steer", { width: 3, maxChars: 50 });
  state = applyPromptKey(state, "HOME", { width: 3, maxChars: 50 }).state;
  state = applyPromptKey(state, "RIGHT", { width: 3, maxChars: 50 }).state;
  state = applyPromptKey(state, "DOWN", { width: 3, maxChars: 50 }).state;
  expect(state.cursor).toBe(4);
  const action = applyPromptKey(state, "ENTER", { width: 3, maxChars: 50 });
  expect(action.kind).toBe("submit");
  expect(action.value).toBe("abcdef");
  expect(action.state.text).toBe("");
});

test("queue, cancellation, and mode toggle are explicit actions", () => {
  const model = new PromptModel({ width: 20, maxChars: 100 });
  model.handle("q");
  expect(model.handle("ALT+ENTER")).toMatchObject({
    kind: "queue",
    value: "q",
  });
  model.handle("x");
  expect(model.handle("ESC").kind).toBe("cancel");
  model.handle("CTRL+Q");
  expect(model.snapshot.mode).toBe("queue");
});

test("prompt history recalls submissions and restores the draft", () => {
  const model = new PromptModel({ width: 20, maxChars: 100 });
  model.handle("first");
  model.handle("ENTER");
  model.handle("second");
  model.handle("ENTER");
  expect(model.handle("UP").state.text).toBe("second");
  expect(model.handle("UP").state.text).toBe("first");
  expect(model.handle("DOWN").state.text).toBe("second");
  expect(model.handle("DOWN").state.text).toBe("");
});
