import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeNativeDSP } from "./native-dsp.ts";
import { algorithmicReverbWet } from "./effects/space.ts";

describe("optional native DSP", () => {
  test("verifies manifest bytes before loading and requires its separate ABI/capability", () => {
    const dir = mkdtempSync(join(tmpdir(), "dawg-dsp-test-"));
    const file = "darwin-arm64/libdawg_sink.dylib";
    mkdirSync(join(dir, "darwin-arm64"));
    writeFileSync(join(dir, file), "fixture");
    const manifest = {
      abi: 1,
      libraries: {
        "darwin-arm64": {
          file,
          sha256: createHash("sha256").update("fixture").digest("hex"),
        },
      },
    };
    const save = () =>
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    save();
    let opens = 0,
      closes = 0,
      abi = 1,
      caps = 1;
    const options = {
      dir,
      env: {},
      platform: "darwin",
      arch: "arm64",
      open: () => {
        opens += 1;
        return {
          close: () => {
            closes += 1;
          },
          symbols: {
            dawg_dsp_abi_version: () => abi,
            dawg_dsp_capabilities: () => caps,
            dawg_dsp_reverb_f64: () => 1,
          },
        };
      },
      pointer: (view: ArrayBufferView) => view,
    };
    try {
      const result = probeNativeDSP(options);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.detail).toContain("verified");
        result.close();
        result.close();
        expect(
          result.reverb(
            new Float64Array(1),
            new Float64Array(1),
            new Float64Array(1),
            new Uint32Array(24),
            new Float64Array(16),
            0.2,
          ),
        ).toBe(false);
      }
      expect(closes).toBe(1);
      abi = 9;
      expect(probeNativeDSP(options).ok).toBe(false);
      expect(closes).toBe(2);
      abi = 1;
      caps = 0;
      expect(probeNativeDSP(options).ok).toBe(false);
      expect(closes).toBe(3);
      manifest.libraries["darwin-arm64"].sha256 = "bad";
      save();
      expect(probeNativeDSP(options)).toEqual({
        ok: false,
        reason: "native DSP sha256 mismatch",
      });
      expect(opens).toBe(3);
      expect(probeNativeDSP({ ...options, arch: "x64" }).ok).toBe(false);
      expect(
        probeNativeDSP({ ...options, env: { DAWG_NATIVE_DSP: "0" } }).ok,
      ).toBe(false);
      expect(opens).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("missing libraries and loader failures fall back, rejected kernels preserve reference output", () => {
    expect(probeNativeDSP({ dir: "/no-such-dawg-dsp", env: {} }).ok).toBe(
      false,
    );
    expect(
      probeNativeDSP({
        env: { DAWG_SINK_LIB: "/not-a-library" },
        open: () => {
          throw Error("missing symbol");
        },
      }).ok,
    ).toBe(false);
    const left = new Float64Array(4096),
      right = new Float64Array(4096);
    left[0] = 1;
    const config = {
      mix: 0.3,
      size: 0.4,
      fade: 1.2,
      dim: 3300,
      predelay: 0.02,
      lowpass: 4000,
    };
    const expected = algorithmicReverbWet(left, right, config, 22050, null);
    const actual = algorithmicReverbWet(
      left,
      right,
      config,
      22050,
      () => false,
    );
    expect(Buffer.from(actual.left.buffer)).toEqual(
      Buffer.from(expected.left.buffer),
    );
    expect(Buffer.from(actual.right.buffer)).toEqual(
      Buffer.from(expected.right.buffer),
    );
    expect(left[0]).toBe(1);
    expect(right.every((v) => v === 0)).toBe(true);
  });

  test("a failed native call closes the library once and permanently falls back", () => {
    for (const failure of ["rejected", "exception"]) {
      let calls = 0;
      let closes = 0;
      const probe = probeNativeDSP({
        env: { DAWG_SINK_LIB: "/explicit-test-library" },
        platform: "darwin",
        arch: "arm64",
        pointer: (view: ArrayBufferView) => view,
        open: () => ({
          close: () => {
            closes += 1;
          },
          symbols: {
            dawg_dsp_abi_version: () => 1,
            dawg_dsp_capabilities: () => 1,
            dawg_dsp_reverb_f64: () => {
              calls += 1;
              if (failure === "exception") throw new Error("test failure");
              return 0;
            },
          },
        }),
      });
      expect(probe.ok).toBe(true);
      if (!probe.ok) throw new Error(probe.reason);
      const aliased = new Float64Array(1);
      expect(
        probe.reverb(
          aliased,
          aliased,
          new Float64Array(1),
          new Uint32Array(24).fill(1),
          new Float64Array(16),
          0.2,
        ),
      ).toBe(false);
      expect(calls).toBe(0);
      for (let attempt = 0; attempt < 2; attempt += 1)
        expect(
          probe.reverb(
            new Float64Array(1),
            new Float64Array(1),
            new Float64Array(1),
            new Uint32Array(24).fill(1),
            new Float64Array(16),
            0.2,
          ),
        ).toBe(false);
      probe.close();
      expect(calls).toBe(1);
      expect(closes).toBe(1);
    }
  });
});
