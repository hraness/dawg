import * as ops from "./ops.ts";
import {
  decodeWavBytes,
  encodeWav24,
  mono,
  peak,
  rms,
  slicePcm,
} from "./pcm.ts";

/** Explicit allowlist: workers execute audio arithmetic, never file or shell operations. */
export const chopComputations = {
  ...ops,
  decodeWavBytes,
  encodeWav24,
  mono,
  peak,
  rms,
  slicePcm,
};
type Functions = {
  [
    K in keyof typeof chopComputations as (typeof chopComputations)[K] extends (
      ...args: any[]
    ) => any
      ? K
      : never
  ]: (typeof chopComputations)[K];
};
export type ChopComputer = {
  [K in keyof Functions]: (
    ...args: Parameters<Functions[K]>
  ) => Promise<ReturnType<Functions[K]>>;
};
export type ChopComputation = keyof Functions;

/** The synchronous implementation remains available to CLI/tests, behind the same API. */
export function chopComputer(
  execute?: (name: ChopComputation, args: unknown[]) => Promise<unknown>,
): ChopComputer {
  return Object.fromEntries(
    Object.entries(chopComputations)
      .filter(([, value]) => typeof value === "function")
      .map(([name, fn]) => [
        name,
        async (...args: unknown[]) =>
          execute
            ? execute(name as ChopComputation, args)
            : (fn as (...args: unknown[]) => unknown)(...args),
      ]),
  ) as ChopComputer;
}
