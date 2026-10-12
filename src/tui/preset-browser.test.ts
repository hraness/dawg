import { describe, expect, test } from "bun:test";
import { presetByName } from "../../core/presets/index.ts";
import { TuiApp } from "../../tui/app.ts";
import { presetScore } from "../commands/preset.ts";
import { browserRank, categoryPicker, presetItem } from "./preset-browser.ts";

const options = { favorites: new Set<string>() };

describe("preset browser search", () => {
  test("typing fuzzy names finds categories and visible special rows", () => {
    const app = new TuiApp({
      io: { write() {}, columns: () => 80, rows: () => 24 },
    });
    for (const [query, value] of [
      ["drms", "/presets drums"],
      ["DRMS", "/presets drums"],
      ["strd", "/presets favorites"],
      ["fvrt", "/presets favorites"],
    ]) {
      app.openPicker(categoryPicker(options));
      for (const key of query!) app.input(key);
      expect(app.picker?.items.map((item) => item.value)).toContain(value);
    }
  });

  test("domain preset ranking survives and outranks exact category matches", () => {
    const preset = presetByName("warm-pad")!;
    const row = presetItem(preset, options);
    for (const query of ["warm-pad", "wrmpd", "warm pad"])
      expect(browserRank(query, row)).toBe(presetScore(preset, query));
    const categories = categoryPicker(options).items;
    const drums = categories.find((item) => item.value === "/presets drums")!;
    expect(browserRank("drums", drums)).toBeGreaterThan(
      browserRank("drms", drums),
    );
    expect(browserRank("warm-pad", row)).toBeGreaterThan(
      browserRank("drums", drums),
    );
    expect(browserRank("zzzzqqq", drums)).toBe(0);
  });
});
