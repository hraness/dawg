/**
 * The user patch library and `patch load github:…` against a local fixture
 * manifest: no network, every fetch answered by a fake.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePatch } from "../../core/patch.ts";
import { BUILTIN_PATCHES } from "../../core/patches/index.ts";
import {
  listUserPatches,
  loadPatchSource,
  parsePatchSource,
  readUserPatch,
  saveUserPatch,
  userPatchDir,
} from "./patch-library.ts";
import type { FetchLike } from "./packs.ts";

const dirs: string[] = [];
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-patchlib-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

const ACID = BUILTIN_PATCHES["acid-bass"]!;
/** The validated (canonical) form a library read returns. */
const canonical = (patch: typeof ACID) => validatePatch(patch);

/** A fake GitHub raw host serving `files`; records every URL asked for. */
function fixture(files: Record<string, string>): {
  fetch: FetchLike;
  asked: string[];
} {
  const asked: string[] = [];
  const fetch: FetchLike = async (input) => {
    asked.push(input);
    const body = files[input];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(body, { status: 200 });
  };
  return { fetch, asked };
}

const BASE = "https://raw.githubusercontent.com/someone/patches/main";

describe("user library", () => {
  test("XDG_DATA_HOME/dawg/patches, DAWG_PATCHES_DIR overrides", () => {
    expect(userPatchDir({ XDG_DATA_HOME: "/x", HOME: "/h" })).toBe(
      "/x/dawg/patches",
    );
    expect(userPatchDir({ HOME: "/h" })).toBe("/h/.local/share/dawg/patches");
    expect(userPatchDir({ DAWG_PATCHES_DIR: "/p", HOME: "/h" })).toBe("/p");
  });

  test("save then read round-trips the patch and its knob settings", async () => {
    const dir = await temp();
    const path = await saveUserPatch(ACID, {
      dir,
      name: "my-acid",
      macros: { cutoff: 900 },
      tags: ["bass"],
    });
    expect(path).toBe(join(dir, "my-acid.json"));
    const file = await readUserPatch("my-acid", dir);
    expect(file?.patch).toEqual(canonical({ ...ACID, name: "my-acid" }));
    expect(file?.macros).toEqual({ cutoff: 900 });
    expect(file?.tags).toEqual(["bass"]);
    expect(await listUserPatches(dir)).toEqual(["my-acid"]);
    expect(await readUserPatch("nope", dir)).toBeUndefined();
  });

  test("a bad file is refused with its name", async () => {
    const dir = await temp();
    await writeFile(join(dir, "broken.json"), "{");
    await expect(readUserPatch("broken", dir)).rejects.toThrow(
      "user patch broken is not valid JSON",
    );
    await writeFile(
      join(dir, "wrong.json"),
      JSON.stringify({
        patch: { ...ACID, nodes: [{ id: "x", type: "warp" }] },
      }),
    );
    await expect(readUserPatch("wrong", dir)).rejects.toThrow("warp");
  });
});

describe("patch packs (local fixture, no network)", () => {
  test("sources parse; anything else names the shape", () => {
    expect(parsePatchSource("github:someone/patches/acid-bass")).toMatchObject({
      user: "someone",
      repo: "patches",
      branch: "main",
      name: "acid-bass",
    });
    expect(parsePatchSource("github:a/b@dev/x").manifestUrl).toBe(
      "https://raw.githubusercontent.com/a/b/dev/patches.json",
    );
    expect(() => parsePatchSource("github:a/b")).toThrow(
      "github:<user>/<repo>[@<branch>]/<patch>",
    );
    expect(() => parsePatchSource("github:a/../x")).toThrow();
  });

  test("loads through the manifest, pins sha256, caches for offline", async () => {
    const dir = await temp();
    const body = JSON.stringify({ sdk: "1.34.0", patch: ACID });
    const { fetch, asked } = fixture({
      [`${BASE}/patches.json`]: JSON.stringify({
        license: "CC0-1.0",
        patches: { "acid-bass": "bass/acid.json" },
      }),
      [`${BASE}/bass/acid.json`]: body,
    });
    const loaded = await loadPatchSource("github:someone/patches/acid-bass", {
      dir,
      fetch,
    });
    expect(asked).toEqual([`${BASE}/patches.json`, `${BASE}/bass/acid.json`]);
    expect(loaded.license).toBe("CC0-1.0");
    expect(loaded.sha256).toHaveLength(64);
    expect(loaded.from).toBe(
      `pack:someone/patches/acid-bass@${loaded.sha256.slice(0, 12)}`,
    );
    expect(loaded.patch.from).toBe(loaded.from);
    expect(loaded.patch).toEqual(canonical({ ...ACID, from: loaded.from }));

    // Offline: both files come from the cache, and the pin still holds.
    const again = await loadPatchSource("github:someone/patches/acid-bass", {
      dir,
      offline: true,
      pin: loaded.sha256.slice(0, 12),
    });
    expect(again.cached).toBe(true);
    expect(again.from).toBe(loaded.from);
  });

  test("a changed file fails its pin; a missing patch lists the others", async () => {
    const dir = await temp();
    const { fetch } = fixture({
      [`${BASE}/patches.json`]: JSON.stringify({
        patches: { "acid-bass": "acid.json", wobble: "wobble.json" },
      }),
      [`${BASE}/acid.json`]: JSON.stringify(ACID),
    });
    await expect(
      loadPatchSource("github:someone/patches/acid-bass", {
        dir,
        fetch,
        pin: "0".repeat(12),
      }),
    ).rejects.toThrow("changed upstream");
    await expect(
      loadPatchSource("github:someone/patches/fm-bell", { dir, fetch }),
    ).rejects.toThrow("has no patch fm-bell · it has acid-bass, wobble");
  });

  test("a pack file that is not a valid patch is refused, never run", async () => {
    const dir = await temp();
    const { fetch } = fixture({
      [`${BASE}/patches.json`]: JSON.stringify({ patches: { evil: "e.json" } }),
      [`${BASE}/e.json`]: JSON.stringify({
        ...ACID,
        nodes: [{ id: "x", type: "eval" }],
      }),
    });
    await expect(
      loadPatchSource("github:someone/patches/evil", { dir, fetch }),
    ).rejects.toThrow("eval");
  });
});
