import { describe, expect, test } from "bun:test";
import { cardText } from "./app.ts";
import {
  ActivityFeed,
  ONCE_ACTIONS,
  ONCE_TTL_MS,
  latestSentence,
  stripLine,
} from "./activity.ts";

function feed() {
  let now = 1_000;
  const activity = new ActivityFeed({ clock: () => now });
  return {
    activity,
    advance: (ms: number) => {
      now += ms;
    },
    texts: () => activity.visible(now).map((card) => cardText(card, true)),
  };
}

describe("activity cards", () => {
  test("newlines read as ` · `", () => {
    expect(stripLine("one\ntwo\n\n  three  ")).toBe("one · two · three");
    const { activity, texts } = feed();
    activity.pushCard("tempo 96\nkey A minor", { tone: "success" });
    expect(texts()).toEqual(["✓ tempo 96 · key A minor"]);
  });

  test("a command receipt wins the first slot over a once note", () => {
    const { activity, texts } = feed();
    activity.pushCard("/login adds an agent · optional", { once: true });
    activity.pushCard("96 BPM", { tone: "success" });
    expect(texts()[0]).toBe("✓ 96 BPM");
    expect(texts()[1]).toBe("• /login adds an agent · optional");
  });

  test("the auto-name joins the receipt as a suffix", () => {
    const { activity, texts } = feed();
    activity.pushCard("+2 notes on bass (C4 E4)", { tone: "success" });
    activity.attachNote("named “dusk loop” · /rename");
    expect(texts()).toEqual([
      "✓ +2 notes on bass (C4 E4) · named “dusk loop” · /rename",
    ]);
  });

  test("with no recent receipt, the note is a once card", () => {
    const { activity, texts, advance } = feed();
    activity.pushCard("96 BPM", { tone: "success" });
    advance(ONCE_TTL_MS + 1);
    activity.attachNote("named “dusk loop”");
    expect(texts()[1]).toBe("• named “dusk loop”");
    expect(activity.visible()[1]?.once).toBe(true);
  });

  test("once cards expire after 8 s", () => {
    const { activity, texts, advance } = feed();
    activity.pushCard("tip", { once: true });
    advance(ONCE_TTL_MS - 1);
    expect(texts()).toEqual(["• tip"]);
    expect(activity.nextExpiry()).toBe(1_000 + ONCE_TTL_MS);
    advance(1);
    expect(texts()).toEqual([]);
  });

  test("once cards expire after 3 actions", () => {
    const { activity, texts } = feed();
    activity.pushCard("tip", { once: true });
    for (let index = 1; index < ONCE_ACTIONS; index += 1)
      activity.pushCard(`edit ${index}`, { tone: "success" });
    expect(texts()).toContain("• tip");
    activity.pushRequest("add a bass");
    expect(texts()).not.toContain("• tip");
  });

  test("duplicates collapse to ×N", () => {
    const { activity, texts } = feed();
    activity.pushError("main is not a drum track");
    activity.pushError("main is not a drum track");
    activity.pushError("main is not a drum track");
    expect(texts()).toEqual(["✗ main is not a drum track ×3"]);
    expect(activity.cards).toHaveLength(1);
    activity.pushCard("96 BPM", { tone: "success" });
    expect(texts()).toEqual(["✓ 96 BPM", "✗ main is not a drum track ×3"]);
  });

  test("the spinner tail is the latest sentence, not a raw tail", () => {
    expect(latestSentence("I'll lay a bass. Then drums")).toBe(
      "I'll lay a bass.",
    );
    expect(latestSentence("I'll lay a bass. Then a busy drum fill")).toBe(
      "Then a busy drum fill",
    );
    expect(latestSentence("")).toBe("");
  });

  test("an agent turn that changed the music ends on its receipt", () => {
    const { activity, texts } = feed();
    activity.applyAgentEvent({ type: "start" });
    activity.applyAgentEvent({ type: "text-delta", delta: "Slowing it. " });
    expect(activity.streamSentence).toBe("Slowing it.");
    activity.setTurnReceipt("96 BPM · +2 notes on bass (C4 E4)");
    activity.applyAgentEvent({
      type: "done",
      text: "Slowing it. Done!",
      applied: 2,
    });
    expect(texts()[0]).toBe("◆ 96 BPM · +2 notes on bass (C4 E4) · ^z undo");
    // The prose went to the ctrl-o log.
    expect(
      activity.transcript.some((e) => e.text.trim() === "Slowing it."),
    ).toBe(true);
    // A turn with no change answers in its first sentence.
    activity.applyAgentEvent({ type: "start" });
    activity.applyAgentEvent({
      type: "done",
      text: "It is in F minor. The bass doubles the root.",
      applied: 0,
    });
    expect(texts()[0]).toBe("◆ It is in F minor.");
  });
});
