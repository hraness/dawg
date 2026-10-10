import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  GEN_PATH,
  SDK_PATH,
  generatedModule,
  syncedSdk,
} from "../../scripts/gen-patch-sdk.ts";
import { BOUNDARY_SPECS, NODE_SPECS } from "../patch-nodes.ts";
import { PATCH_NODE_PORTS } from "./v1.ts";

describe("generated patch node types", () => {
  test("core/sdk/patch-nodes.gen.ts is up to date (bun scripts/gen-patch-sdk.ts)", async () => {
    expect(await readFile(GEN_PATH, "utf8")).toBe(await generatedModule());
  });

  test("the block spliced into core/sdk/v1.ts is up to date", async () => {
    const sdk = await readFile(SDK_PATH, "utf8");
    expect(await syncedSdk(sdk)).toBe(sdk);
  });

  test("every node type and boundary has a port row in the SDK", () => {
    expect(Object.keys(PATCH_NODE_PORTS).sort()).toEqual(
      [...Object.keys(NODE_SPECS), ...Object.keys(BOUNDARY_SPECS)].sort(),
    );
  });
});
