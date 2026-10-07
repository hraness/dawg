/**
 * Reverse deltas for session history.
 *
 * Every event stores a `rewind`: how to turn the composition it produced back
 * into the one it replaced, instead of the whole previous composition.
 * Objects diff per key, arrays of `{id}` objects diff per id and position,
 * and anything else is replaced wholesale. Applying the rewinds of the newest
 * events in reverse order recovers any older composition, which is what undo
 * and the daemon's rebase need. A single-note edit costs about 150 bytes
 * instead of a full copy of the score, so the record stays small and the
 * session never becomes un-editable.
 */
export type Rewind =
  /** The value in the earlier composition (also used for a key that was removed). */
  | { set: unknown }
  /** The key did not exist in the earlier composition. */
  | { del: true }
  /** Per-key rewinds for a plain object. */
  | { obj: Record<string, Rewind> }
  /**
   * An array of `{id}` objects: remove the items at `drop` (indices into the
   * later array), then place `put` values at their earlier indices.
   */
  | { arr: { drop: number[]; put: [number, unknown][] } };

const MAX_DEPTH = 16;

/** Applying this rewind changes nothing. */
export const IDENTITY_REWIND: Rewind = Object.freeze({ obj: {} }) as Rewind;

export function isIdentityRewind(value: Rewind | undefined): boolean {
  return (
    value !== undefined && "obj" in value && Object.keys(value.obj).length === 0
  );
}

/** The rewind that turns `after` back into `before`; identity when equal. */
export function diffRewind(before: unknown, after: unknown): Rewind {
  return diff(before, after, 0) ?? IDENTITY_REWIND;
}

function diff(
  before: unknown,
  after: unknown,
  depth: number,
): Rewind | undefined {
  if (depth >= MAX_DEPTH)
    return deepEqual(before, after) ? undefined : { set: before };
  if (isPlainObject(before) && isPlainObject(after)) {
    const obj: Record<string, Rewind> = {};
    for (const key of Object.keys(before)) {
      if (!(key in after) || after[key] === undefined)
        obj[key] = { set: before[key] };
      else {
        const child = diff(before[key], after[key], depth + 1);
        if (child) obj[key] = child;
      }
    }
    for (const key of Object.keys(after))
      if (!(key in before) || before[key] === undefined)
        obj[key] = { del: true };
    return Object.keys(obj).length === 0 ? undefined : { obj };
  }
  if (isKeyedArray(before) && isKeyedArray(after)) {
    const beforeIndex = new Map<string, number>();
    before.forEach((item, index) => beforeIndex.set(item.id, index));
    // Greedy common subsequence by id: an item is kept when it is unchanged
    // and keeps its relative order. Edits touch few items, so this is near
    // optimal and always correct; a full reorder degrades to a full copy.
    const kept = new Set<number>();
    const drop: number[] = [];
    let last = -1;
    after.forEach((item, index) => {
      const at = beforeIndex.get(item.id);
      if (at !== undefined && at > last && deepEqual(before[at], item)) {
        kept.add(at);
        last = at;
      } else drop.push(index);
    });
    const put: [number, unknown][] = [];
    before.forEach((item, index) => {
      if (!kept.has(index)) put.push([index, item]);
    });
    return drop.length === 0 && put.length === 0
      ? undefined
      : { arr: { drop, put } };
  }
  return deepEqual(before, after) ? undefined : { set: before };
}

/** The earlier value: `rewind` applied to `after`. Throws on a shape mismatch. */
export function applyRewind(after: unknown, rewind: Rewind): unknown {
  if ("set" in rewind) return rewind.set;
  if ("del" in rewind) return undefined;
  if ("obj" in rewind) {
    // The identity rewind applies to any value, not only objects.
    if (isIdentityRewind(rewind)) return after;
    if (!isPlainObject(after)) throw new Error("rewind expects an object");
    const result: Record<string, unknown> = { ...after };
    for (const [key, child] of Object.entries(rewind.obj)) {
      if ("del" in child) delete result[key];
      else result[key] = applyRewind(result[key], child);
    }
    return result;
  }
  if (!Array.isArray(after)) throw new Error("rewind expects an array");
  const dropped = new Set(rewind.arr.drop);
  const kept: unknown[] = [];
  after.forEach((item, index) => {
    if (!dropped.has(index)) kept.push(item);
  });
  const put = new Map(rewind.arr.put);
  const length = kept.length + put.size;
  const result: unknown[] = [];
  let next = 0;
  for (let index = 0; index < length; index += 1) {
    if (put.has(index)) result.push(put.get(index));
    else {
      if (next >= kept.length) throw new Error("rewind indices are invalid");
      result.push(kept[next]);
      next += 1;
    }
  }
  if (next !== kept.length) throw new Error("rewind indices are invalid");
  return result;
}

/**
 * The composition before `events[index]`, by rewinding `composition` (the
 * one after the last event) through every later event. Undefined when any
 * event in that range has no usable rewind.
 */
export function rewindComposition(
  composition: unknown,
  events: readonly { rewind?: Rewind | undefined }[],
  index: number,
): unknown {
  if (!Number.isSafeInteger(index) || index < 0 || index >= events.length)
    return undefined;
  let value = composition;
  try {
    for (let at = events.length - 1; at >= index; at -= 1) {
      const rewind = events[at]!.rewind;
      if (rewind === undefined) return undefined;
      value = applyRewind(value, rewind);
    }
  } catch {
    return undefined;
  }
  return value;
}

/** Validates a stored rewind from `unknown`; `undefined` when absent. */
export function parseRewind(value: unknown): Rewind | undefined {
  if (value === undefined) return undefined;
  return parse(value, 0);
}

function parse(value: unknown, depth: number): Rewind {
  if (!isPlainObject(value) || depth > MAX_DEPTH)
    throw new Error("session event rewind is invalid");
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new Error("session event rewind is invalid");
  if ("set" in value) {
    if (value.set === undefined)
      throw new Error("session event rewind is invalid");
    return { set: value.set };
  }
  if ("del" in value) {
    if (value.del !== true) throw new Error("session event rewind is invalid");
    return { del: true };
  }
  if ("obj" in value) {
    if (!isPlainObject(value.obj))
      throw new Error("session event rewind is invalid");
    const obj: Record<string, Rewind> = {};
    for (const [key, child] of Object.entries(value.obj))
      obj[key] = parse(child, depth + 1);
    return { obj };
  }
  if ("arr" in value && isPlainObject(value.arr)) {
    const { drop, put } = value.arr;
    if (
      !Array.isArray(drop) ||
      !Array.isArray(put) ||
      !drop.every((index) => Number.isSafeInteger(index) && index >= 0) ||
      !put.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          Number.isSafeInteger(entry[0]) &&
          entry[0] >= 0 &&
          entry[1] !== undefined,
      )
    )
      throw new Error("session event rewind is invalid");
    return {
      arr: {
        drop: drop as number[],
        put: put.map((entry) => [entry[0], entry[1]] as [number, unknown]),
      },
    };
  }
  throw new Error("session event rewind is invalid");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isKeyedArray(value: unknown): value is { id: string }[] {
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item) || typeof item.id !== "string") return false;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
  }
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  )
    return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    if (a.length !== other.length) return false;
    for (let index = 0; index < a.length; index += 1)
      if (!deepEqual(a[index], other[index])) return false;
    return true;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => left[key] !== undefined);
  const otherKeys = Object.keys(right).filter(
    (key) => right[key] !== undefined,
  );
  if (keys.length !== otherKeys.length) return false;
  for (const key of keys)
    if (!(key in right) || !deepEqual(left[key], right[key])) return false;
  return true;
}
