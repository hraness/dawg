/**
 * Collision-free ids for things two writers can create at once (notes from
 * agent tools, resamples, guide tracks). A readable prefix keeps receipts
 * legible; the suffix is random and salted with this machine's actor so two
 * actors never draw the same id even without an authority to serialise them.
 *
 * Track ids and patcher node ids stay readable and are allocated by the
 * authority (dawgd's `claimTrack`), never chosen here.
 */
import { SCORE_LIMITS } from "./score.ts";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const SALT_LENGTH = 3;
const RANDOM_LENGTH = 8;

let salt = "";

/**
 * Set once per process from the actor id (src/identity/actor.ts). Tests and
 * one-shot tools that never set it still get random ids.
 */
export function setIdSalt(actorId: string): void {
  const clean = actorId.replace(/^a_/, "").toLowerCase();
  salt = [...clean]
    .filter((char) => ALPHABET.includes(char))
    .slice(0, SALT_LENGTH)
    .join("");
}

export function idSalt(): string {
  return salt;
}

/** `count` characters of base32 from the platform CSPRNG. */
export function randomBase32(count: number): string {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte & 31];
  return out;
}

/**
 * `<prefix>-<salt><random>`, bounded to a score id. The prefix is trimmed so
 * the random part always survives.
 */
export function newId(prefix: string): string {
  const suffix = `${salt}${randomBase32(RANDOM_LENGTH)}`;
  const room = SCORE_LIMITS.maxIdLength - suffix.length - 1;
  const head = prefix.slice(0, Math.max(0, room)).replace(/-+$/, "");
  return head.length > 0 ? `${head}-${suffix}` : suffix;
}
