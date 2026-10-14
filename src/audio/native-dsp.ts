/** Optional bulk DSP in the hash-verified sink artifact, with its own ABI.
 * Loading this module never opens an audio device. Missing, old or corrupt
 * binaries keep the reference JavaScript path. No compile/download at runtime.
 */
import { dlopen, FFIType as T, ptr } from "bun:ffi";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NativeManifest } from "./native.ts";

export const DSP_ABI_VERSION = 1;
/** CI executes exact JS/native parity on each of these targets. Mac x64 is
 * cross-compiled only, and deliberately keeps JavaScript until qualified. */
export const DSP_TARGETS = [
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
] as const;
export type ReverbKernel = (
  input: Float64Array,
  left: Float64Array,
  right: Float64Array,
  lengths: Uint32Array,
  gains: Float64Array,
  damp: number,
) => boolean;
type Symbols = {
  dawg_dsp_abi_version(): number;
  dawg_dsp_capabilities(): number;
  dawg_dsp_reverb_f64(
    input: unknown,
    left: unknown,
    right: unknown,
    frames: number,
    lengths: unknown,
    gains: unknown,
    damp: number,
  ): number;
};
type Library = { symbols: Symbols; close(): void };
const open = (path: string): Library =>
  dlopen(path, {
    dawg_dsp_abi_version: { args: [], returns: T.u32 },
    dawg_dsp_capabilities: { args: [], returns: T.u32 },
    dawg_dsp_reverb_f64: {
      args: [T.ptr, T.ptr, T.ptr, T.u64, T.ptr, T.ptr, T.f64],
      returns: T.i32,
    },
  }) as unknown as Library;
export type DSPProbe =
  | { ok: false; reason: string }
  | {
      ok: true;
      path: string;
      detail: string;
      reverb: ReverbKernel;
      close(): void;
    };

export function probeNativeDSP(
  options: {
    env?: Record<string, string | undefined>;
    platform?: string;
    arch?: string;
    dir?: string;
    open?: typeof open;
    pointer?: (view: ArrayBufferView) => unknown;
  } = {},
): DSPProbe {
  const env = options.env ?? process.env;
  if (env.DAWG_NATIVE_DSP === "0")
    return { ok: false, reason: "DAWG_NATIVE_DSP=0" };
  const platform = options.platform ?? process.platform;
  const target = `${platform}-${options.arch ?? process.arch}`;
  if (!(DSP_TARGETS as readonly string[]).includes(target))
    return { ok: false, reason: `native DSP not qualified for ${target}` };
  let library: Library | undefined;
  try {
    // The explicit local-build override is never used by the shipped package.
    let path = env.DAWG_SINK_LIB?.trim();
    let detail = "DAWG_SINK_LIB development override (unverified)";
    if (!path) {
      const dir =
        options.dir ?? join(import.meta.dir, "..", "..", "native", "prebuilt");
      const manifest: NativeManifest = JSON.parse(
        readFileSync(join(dir, "manifest.json"), "utf8"),
      );
      const entry = manifest.libraries?.[target];
      const expected = `${target}/libdawg_sink.${platform === "darwin" ? "dylib" : "so"}`;
      if (manifest.abi !== 1 || !entry || entry.file !== expected)
        return {
          ok: false,
          reason: `native DSP artifact missing for ${target}`,
        };
      path = join(dir, entry.file);
      const digest = createHash("sha256")
        .update(readFileSync(path))
        .digest("hex");
      if (digest !== entry.sha256)
        return { ok: false, reason: "native DSP sha256 mismatch" };
      detail = `${target} sha256 ${digest.slice(0, 12)} verified`;
    }
    library = (options.open ?? open)(path);
    if (
      library.symbols.dawg_dsp_abi_version() !== DSP_ABI_VERSION ||
      (library.symbols.dawg_dsp_capabilities() & 1) === 0
    ) {
      library.close();
      return { ok: false, reason: "native DSP ABI/capability mismatch" };
    }
    const loaded = library;
    const pointer =
      options.pointer ?? (ptr as (view: ArrayBufferView) => unknown);
    let usable = true;
    return {
      ok: true,
      path,
      detail,
      close: () => {
        if (usable) loaded.close();
        usable = false;
      },
      reverb(input, left, right, lengths, gains, damp) {
        if (
          !usable ||
          input.length !== left.length ||
          input.length !== right.length ||
          lengths.length !== 24 ||
          gains.length !== 16 ||
          input.length > 64_000_000
        )
          return false;
        if (input.length === 0) return true;
        // Native mutable output slices must never alias any other argument.
        // Each production buffer is separately owned; reject shared backing
        // storage even when individual views happen to be disjoint.
        const buffers = [input, left, right, lengths, gains].map(
          (v) => v.buffer,
        );
        if (
          new Set(buffers).size !== buffers.length ||
          buffers.some((buffer) => buffer instanceof SharedArrayBuffer)
        )
          return false;
        try {
          const succeeded =
            loaded.symbols.dawg_dsp_reverb_f64(
              pointer(input),
              pointer(left),
              pointer(right),
              input.length,
              pointer(lengths),
              pointer(gains),
              damp,
            ) === 1;
          if (!succeeded) {
            usable = false;
            loaded.close();
          }
          return succeeded;
        } catch {
          usable = false;
          loaded.close();
          return false;
        }
      },
    };
  } catch (error) {
    library?.close();
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

let cached: DSPProbe | undefined;
/** One lazy verification per process; an explicit disable is always honored. */
export function nativeReverbKernel(): ReverbKernel | undefined {
  if (process.env.DAWG_NATIVE_DSP === "0") return undefined;
  cached ??= probeNativeDSP();
  return cached.ok ? cached.reverb : undefined;
}
