import { expect, test } from "bun:test";
import { parseTime, parseTimeInFile } from "./time.ts";

test("source percentage times preserve selected sample windows at any duration", () => {
  expect(parseTime("25%", 2)).toBe(0.5);
  expect(parseTime("100%", 7.25)).toBe(7.25);
  expect(parseTimeInFile("0%", 2, "from")).toBe(0);
  expect(parseTime("12.500000000000%", 8)).toBe(1);
  expect(() => parseTime("101%", 2)).toThrow("bad time");
  expect(() => parseTime("-101%", 2)).toThrow("bad time");
});
