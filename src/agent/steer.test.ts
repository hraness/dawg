import { describe, expect, test } from "bun:test";
import { routeDuringTurn } from "./steer.ts";

describe("routeDuringTurn", () => {
  const local = (text: string) => /^(tempo|play|stop|note)\b/.test(text);
  test("typed commands run beside the turn", () => {
    expect(routeDuringTurn("tempo 120", local)).toBe("local");
    expect(routeDuringTurn("  play ", local)).toBe("local");
  });
  test("prose, slash commands and blanks steer", () => {
    expect(routeDuringTurn("make the bass busier", local)).toBe("steer");
    expect(routeDuringTurn("/model fast", () => true)).toBe("steer");
    expect(routeDuringTurn("   ", () => true)).toBe("steer");
  });
});
