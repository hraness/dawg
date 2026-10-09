/**
 * Seeded randomness for 0.6 instruments. `seededRandom` is the existing
 * sequential generator (src/audio/random.ts, unchanged); `unit` is a
 * counter-based draw that is a pure function of (seed, index, slot), so one
 * grain's or voice's draws never depend on how many draws came before it.
 * Integer-only, identical on every platform. Never use Math.random.
 */
export { seededRandom } from "../random.ts";

/** FNV-1a of a string: turns a stored seed plus a note id into a 32-bit key. */
export function seedHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** MurmurHash3 32-bit finaliser. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Counter-based random in [0, 1): draw `slot` of item `index` under `seed`.
 * Changing one knob (say a reverse probability) does not reshuffle the rest.
 */
export function unit(seed: number, index: number, slot: number): number {
  const a = fmix32((seed ^ Math.imul(index | 0, 0x9e3779b1)) >>> 0);
  return fmix32((a ^ Math.imul(slot + 1, 0x7feb352d)) >>> 0) / 4_294_967_296;
}
