/** Envelope kernels: adsr, ar, slew and follow (per sample, gates sampled). */
import { at, BLOCK, type Frame } from "./frame.ts";

/**
 * adsr: gate (sampled), attack, decay, sustain, release → out 0..1.
 * Linear segments; a rising gate re-attacks from the current level.
 * State: stage (0 idle, 1 attack, 2 decay, 3 sustain, 4 release), level,
 * release step.
 */
export function adsr(f: Frame, n: number): void {
  const m = f.m;
  const st = f.st;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const gate = at(f, n, 0);
  const o = at(f, n, 5);
  const sr = f.sampleRate;
  const attack = f.ctl[c + 1]!;
  const decay = f.ctl[c + 2]!;
  const sustain = f.ctl[c + 3]!;
  const release = f.ctl[c + 4]!;
  const up = attack > 0 ? 1 / (attack * sr) : 1;
  const down = decay > 0 ? (1 - sustain) / (decay * sr) : 1;
  let stage = st[s]!;
  let level = st[s + 1]!;
  let step = st[s + 2]!;
  for (let i = 0; i < BLOCK; i += 1) {
    if (m[gate + i]! > 0.5) {
      if (stage === 0 || stage === 4) stage = 1;
    } else if (stage >= 1 && stage <= 3) {
      stage = 4;
      step = release > 0 ? level / (release * sr) : level;
    }
    if (stage === 1) {
      level += up;
      if (level >= 1) {
        level = 1;
        stage = 2;
      }
    } else if (stage === 2) {
      level -= down;
      if (level <= sustain) {
        level = sustain;
        stage = 3;
      }
    } else if (stage === 3) level = sustain;
    else if (stage === 4) {
      level -= step;
      if (level <= 0) {
        level = 0;
        stage = 0;
      }
    }
    m[o + i] = level;
  }
  st[s] = stage;
  st[s + 1] = level;
  st[s + 2] = step;
}

/** ar: gate (sampled), attack, release → out 0..1 (linear, full-scale times). */
export function ar(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const gate = at(f, n, 0);
  const o = at(f, n, 3);
  const sr = f.sampleRate;
  const attack = f.ctl[c + 1]!;
  const release = f.ctl[c + 2]!;
  const up = attack > 0 ? 1 / (attack * sr) : 1;
  const down = release > 0 ? 1 / (release * sr) : 1;
  let level = f.st[s]!;
  for (let i = 0; i < BLOCK; i += 1) {
    level =
      m[gate + i]! > 0.5 ? Math.min(1, level + up) : Math.max(0, level - down);
    m[o + i] = level;
  }
  f.st[s] = level;
}

/** slew: in (sampled), rise, fall → out. State: value, started flag. */
export function slew(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const x = at(f, n, 0);
  const o = at(f, n, 3);
  const sr = f.sampleRate;
  const rise = f.ctl[c + 1]!;
  const fall = f.ctl[c + 2]!;
  const up = rise > 0 ? 1 / (rise * sr) : Infinity;
  const down = fall > 0 ? 1 / (fall * sr) : Infinity;
  let y = f.st[s + 1]! === 0 ? m[x]! : f.st[s]!;
  for (let i = 0; i < BLOCK; i += 1) {
    const target = m[x + i]!;
    if (target > y) y = Math.min(target, y + up);
    else if (target < y) y = Math.max(target, y - down);
    m[o + i] = y;
  }
  f.st[s] = y;
  f.st[s + 1] = 1;
}

/** follow: in (audio), attack, release → out 0..1 (peak follower). */
export function follow(f: Frame, n: number): void {
  const m = f.m;
  const c = f.ctlBase[n]!;
  const s = f.stBase[n]!;
  const x = at(f, n, 0);
  const o = at(f, n, 3);
  const sr = f.sampleRate;
  const ca = Math.exp(-1 / (f.ctl[c + 1]! * sr));
  const cr = Math.exp(-1 / (f.ctl[c + 2]! * sr));
  let env = f.st[s]!;
  for (let i = 0; i < BLOCK; i += 1) {
    const v = m[x + i]!;
    const a = v < 0 ? -v : v;
    env = a > env ? a + (env - a) * ca : a + (env - a) * cr;
    if (env < 1e-30) env = 0;
    m[o + i] = env > 1 ? 1 : env;
  }
  f.st[s] = env;
}
