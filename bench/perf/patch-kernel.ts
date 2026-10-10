/**
 * The patcher inner-loop micro-benchmark from the language assessment
 * (.plans/lang/assessment.md 2.6): 12 nodes per voice (LFOs, saw with FM,
 * pulse with PWM, sine sub, noise, mix, two ADSRs, TPT SVF, VCA, stereo
 * out), 16 voices, 32-sample blocks, 48 kHz, polynomial sine. `interp` is a
 * flat Float64Array interpreter dispatching per node per block; `fused` is
 * the hand-fused voice loop a code generator would emit (the TS ceiling).
 * Reports ns per voice-sample.
 */
/* eslint-disable */
// prettier-ignore
const SR = 48000, BLOCK = 32, VOICES = 16;
const enum K {
  LFO_SIN,
  LFO_TRI,
  SAW,
  PULSE,
  SINE,
  NOISE,
  MIX4,
  ADSR,
  SVF,
  VCA,
  OUT,
}
// buffers per voice: 0 lfo1,1 lfo2,2 saw,3 pulse,4 sub,5 noise,6 mix,7 envF,8 lp,9 envA,10 vca
type Node = {
  kind: K;
  a: number;
  b: number;
  c: number;
  d: number;
  out: number;
  p: number;
  s: number;
};
// p: param offset, s: state offset
const NODES: Node[] = [
  { kind: K.LFO_SIN, a: -1, b: -1, c: -1, d: -1, out: 0, p: 0, s: 0 },
  { kind: K.LFO_TRI, a: -1, b: -1, c: -1, d: -1, out: 1, p: 1, s: 1 },
  { kind: K.SAW, a: 0, b: -1, c: -1, d: -1, out: 2, p: 2, s: 2 },
  { kind: K.PULSE, a: 1, b: -1, c: -1, d: -1, out: 3, p: 3, s: 3 },
  { kind: K.SINE, a: -1, b: -1, c: -1, d: -1, out: 4, p: 4, s: 4 },
  { kind: K.NOISE, a: -1, b: -1, c: -1, d: -1, out: 5, p: 5, s: 5 },
  { kind: K.MIX4, a: 2, b: 3, c: 4, d: 5, out: 6, p: 6, s: 6 },
  { kind: K.ADSR, a: -1, b: -1, c: -1, d: -1, out: 7, p: 10, s: 6 },
  { kind: K.SVF, a: 6, b: 7, c: -1, d: -1, out: 8, p: 14, s: 8 },
  { kind: K.ADSR, a: -1, b: -1, c: -1, d: -1, out: 9, p: 17, s: 10 },
  { kind: K.VCA, a: 8, b: 9, c: -1, d: -1, out: 10, p: 21, s: 12 },
  { kind: K.OUT, a: 10, b: -1, c: -1, d: -1, out: -1, p: 22, s: 12 },
];
const NBUF = 11,
  NSTATE = 13,
  NPARAM = 24;

function sinp(p: number): number {
  // sin(2*pi*p), p in [0,1)
  const x = 2 * (p - 0.5); // [-1,1)
  const ax = x < 0 ? -x : x;
  let y = 4 * x * (1 - ax);
  const ay = y < 0 ? -y : y;
  y = 0.225 * (y * ay - y) + y;
  return -y;
}

type Arr = Float64Array | Float32Array;
function setup(Ctor: { new (n: number): Arr }) {
  const voices = [] as {
    buf: Arr;
    st: Arr;
    pr: Arr;
    rng: Uint32Array;
    gate: number;
    pan: [number, number];
    f0: number;
  }[];
  for (let v = 0; v < VOICES; v++) {
    const f0 = 110 * Math.pow(2, ((v * 7) % 24) / 12);
    const pr = new Ctor(NPARAM);
    pr[0] = 5.3 / SR;
    pr[1] = (0.7 + v * 0.05) / SR;
    pr[2] = f0 / SR;
    pr[3] = (f0 * 1.005) / SR;
    pr[4] = (f0 * 0.5) / SR;
    pr[5] = 0;
    pr[6] = 0.4;
    pr[7] = 0.3;
    pr[8] = 0.3;
    pr[9] = 0.05;
    // adsr F: attack inc, decay coef, sustain, release coef
    pr[10] = 1 / (0.005 * SR);
    pr[11] = 0.9995;
    pr[12] = 0.2;
    pr[13] = 0.999;
    pr[14] = 200;
    pr[15] = 4000;
    pr[16] = 0.6; // svf base, depth, res
    pr[17] = 1 / (0.01 * SR);
    pr[18] = 0.9998;
    pr[19] = 0.7;
    pr[20] = 0.9995;
    pr[21] = 0.5 + 0.03 * v; // vel
    const rng = new Uint32Array([0x9e3779b9 ^ (v * 2654435761)]);
    if (rng[0] === 0) rng[0] = 1;
    const ang = v / (VOICES - 1);
    voices.push({
      buf: new Ctor(NBUF * BLOCK),
      st: new Ctor(NSTATE),
      pr,
      rng,
      gate: 0,
      pan: [1 - 0.5 * ang, 0.5 + 0.5 * ang],
      f0,
    });
  }
  return voices;
}

// gate schedule: voice v retriggers every 24000 samples offset by v*1500, held 14400 samples
function gateAt(v: number, frame: number): number {
  const t = (frame + v * 1500) % 24000;
  return t < 14400 ? 1 : 0;
}

function runInterp(
  Ctor: { new (n: number): Arr },
  outL: Float64Array,
  outR: Float64Array,
) {
  const voices = setup(Ctor);
  const blocks = outL.length / BLOCK;
  const nodes = NODES,
    nn = nodes.length;
  const kinds = new Int32Array(nn),
    ia = new Int32Array(nn),
    ib = new Int32Array(nn),
    ic = new Int32Array(nn),
    id = new Int32Array(nn),
    io = new Int32Array(nn),
    ip = new Int32Array(nn),
    is = new Int32Array(nn);
  nodes.forEach((n, i) => {
    kinds[i] = n.kind;
    ia[i] = n.a * BLOCK;
    ib[i] = n.b * BLOCK;
    ic[i] = n.c * BLOCK;
    id[i] = n.d * BLOCK;
    io[i] = n.out * BLOCK;
    ip[i] = n.p;
    is[i] = n.s;
  });
  // adsr state: [stage, level] stage 0 idle 1 attack 2 decay/sustain 3 release
  for (let blk = 0; blk < blocks; blk++) {
    const base = blk * BLOCK;
    for (let v = 0; v < VOICES; v++) {
      const V = voices[v]!;
      const buf = V.buf,
        st = V.st,
        pr = V.pr;
      const gate = gateAt(v, base);
      for (let k = 0; k < nn; k++) {
        const o = io[k]!,
          p = ip[k]!,
          s = is[k]!;
        switch (kinds[k]) {
          case K.LFO_SIN: {
            let ph = st[s]!;
            const inc = pr[p]!;
            for (let i = 0; i < BLOCK; i++) {
              buf[o + i] = sinp(ph);
              ph += inc;
              if (ph >= 1) ph -= 1;
            }
            st[s] = ph;
            break;
          }
          case K.LFO_TRI: {
            let ph = st[s]!;
            const inc = pr[p]!;
            for (let i = 0; i < BLOCK; i++) {
              buf[o + i] = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
              ph += inc;
              if (ph >= 1) ph -= 1;
            }
            st[s] = ph;
            break;
          }
          case K.SAW: {
            let ph = st[s]!;
            const inc = pr[p]!,
              a = ia[k]!;
            for (let i = 0; i < BLOCK; i++) {
              buf[o + i] = 2 * ph - 1;
              ph += inc * (1 + 0.003 * buf[a + i]!);
              if (ph >= 1) ph -= 1;
            }
            st[s] = ph;
            break;
          }
          case K.PULSE: {
            let ph = st[s]!;
            const inc = pr[p]!,
              a = ia[k]!;
            for (let i = 0; i < BLOCK; i++) {
              const pw = 0.5 + 0.4 * buf[a + i]!;
              buf[o + i] = ph < pw ? 1 : -1;
              ph += inc;
              if (ph >= 1) ph -= 1;
            }
            st[s] = ph;
            break;
          }
          case K.SINE: {
            let ph = st[s]!;
            const inc = pr[p]!;
            for (let i = 0; i < BLOCK; i++) {
              buf[o + i] = sinp(ph);
              ph += inc;
              if (ph >= 1) ph -= 1;
            }
            st[s] = ph;
            break;
          }
          case K.NOISE: {
            const r = V.rng;
            let x = r[0]!;
            for (let i = 0; i < BLOCK; i++) {
              x ^= x << 13;
              x ^= x >>> 17;
              x ^= x << 5;
              x >>>= 0;
              buf[o + i] = x * (2 / 4294967296) - 1;
            }
            r[0] = x;
            break;
          }
          case K.MIX4: {
            const a = ia[k]!,
              b = ib[k]!,
              c = ic[k]!,
              d = id[k]!;
            const ga = pr[p]!,
              gb = pr[p + 1]!,
              gc = pr[p + 2]!,
              gd = pr[p + 3]!;
            for (let i = 0; i < BLOCK; i++)
              buf[o + i] =
                ga * buf[a + i]! +
                gb * buf[b + i]! +
                gc * buf[c + i]! +
                gd * buf[d + i]!;
            break;
          }
          case K.ADSR: {
            let stage = st[s]!,
              lvl = st[s + 1]!;
            const att = pr[p]!,
              dec = pr[p + 1]!,
              sus = pr[p + 2]!,
              rel = pr[p + 3]!;
            if (gate && (stage === 0 || stage === 3)) stage = 1;
            else if (!gate && (stage === 1 || stage === 2)) stage = 3;
            for (let i = 0; i < BLOCK; i++) {
              if (stage === 1) {
                lvl += att;
                if (lvl >= 1) {
                  lvl = 1;
                  stage = 2;
                }
              } else if (stage === 2) lvl = sus + (lvl - sus) * dec;
              else if (stage === 3) {
                lvl *= rel;
                if (lvl < 1e-5) {
                  lvl = 0;
                  stage = 0;
                }
              }
              buf[o + i] = lvl;
            }
            st[s] = stage;
            st[s + 1] = lvl;
            break;
          }
          case K.SVF: {
            const a = ia[k]!,
              b = ib[k]!;
            let ic1 = st[s]!,
              ic2 = st[s + 1]!;
            const fc = pr[p]! + pr[p + 1]! * buf[b]!; // control rate: env at block start
            const w = (Math.PI * fc) / SR;
            const g = w * (1 + (w * w) / 3);
            const kk = 2 - 2 * pr[p + 2]!;
            const a1 = 1 / (1 + g * (g + kk)),
              a2 = g * a1,
              a3 = g * a2;
            for (let i = 0; i < BLOCK; i++) {
              const v3 = buf[a + i]! - ic2;
              const v1 = a1 * ic1 + a2 * v3;
              const v2 = ic2 + a2 * ic1 + a3 * v3;
              ic1 = 2 * v1 - ic1;
              ic2 = 2 * v2 - ic2;
              buf[o + i] = v2;
            }
            st[s] = ic1;
            st[s + 1] = ic2;
            break;
          }
          case K.VCA: {
            const a = ia[k]!,
              b = ib[k]!,
              vel = pr[p]!;
            for (let i = 0; i < BLOCK; i++)
              buf[o + i] = buf[a + i]! * buf[b + i]! * vel;
            break;
          }
          case K.OUT: {
            const a = ia[k]!;
            const l = V.pan[0],
              r = V.pan[1];
            for (let i = 0; i < BLOCK; i++) {
              const x = buf[a + i]!;
              outL[base + i]! += x * l;
              outR[base + i]! += x * r;
            }
            break;
          }
        }
      }
    }
  }
}

// Hand-fused voice loop: what a code-generating compiler (rejected JIT) would emit. Upper bound for TS.
function runFused(
  Ctor: { new (n: number): Arr },
  outL: Float64Array,
  outR: Float64Array,
) {
  const voices = setup(Ctor);
  const blocks = outL.length / BLOCK;
  for (let v = 0; v < VOICES; v++) {
    const V = voices[v]!,
      pr = V.pr,
      st = V.st;
    let p0 = 0,
      p1 = 0,
      p2 = 0,
      p3 = 0,
      p4 = 0,
      x = V.rng[0]!,
      sF = 0,
      lF = 0,
      sA = 0,
      lA = 0,
      ic1 = 0,
      ic2 = 0;
    const i0 = pr[0]!,
      i1 = pr[1]!,
      i2 = pr[2]!,
      i3 = pr[3]!,
      i4 = pr[4]!;
    const l = V.pan[0],
      r = V.pan[1];
    for (let blk = 0; blk < blocks; blk++) {
      const base = blk * BLOCK;
      const gate = gateAt(v, base);
      if (gate && (sF === 0 || sF === 3)) sF = 1;
      else if (!gate && (sF === 1 || sF === 2)) sF = 3;
      if (gate && (sA === 0 || sA === 3)) sA = 1;
      else if (!gate && (sA === 1 || sA === 2)) sA = 3;
      // control: filter env value at block start = previous block's last sample (matches interp: envF buffer[0] computed first sample of this block)
      // to match interp exactly we compute envF sample 0 first
      let fcSet = false;
      let a1 = 0,
        a2 = 0,
        a3 = 0;
      for (let i = 0; i < BLOCK; i++) {
        const lfo1 = sinp(p0);
        p0 += i0;
        if (p0 >= 1) p0 -= 1;
        const lfo2 = p1 < 0.5 ? 4 * p1 - 1 : 3 - 4 * p1;
        p1 += i1;
        if (p1 >= 1) p1 -= 1;
        const saw = 2 * p2 - 1;
        p2 += i2 * (1 + 0.003 * lfo1);
        if (p2 >= 1) p2 -= 1;
        const pul = p3 < 0.5 + 0.4 * lfo2 ? 1 : -1;
        p3 += i3;
        if (p3 >= 1) p3 -= 1;
        const sub = sinp(p4);
        p4 += i4;
        if (p4 >= 1) p4 -= 1;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        const noi = x * (2 / 4294967296) - 1;
        const mix = pr[6]! * saw + pr[7]! * pul + pr[8]! * sub + pr[9]! * noi;
        if (sF === 1) {
          lF += pr[10]!;
          if (lF >= 1) {
            lF = 1;
            sF = 2;
          }
        } else if (sF === 2) lF = pr[12]! + (lF - pr[12]!) * pr[11]!;
        else if (sF === 3) {
          lF *= pr[13]!;
          if (lF < 1e-5) {
            lF = 0;
            sF = 0;
          }
        }
        if (!fcSet) {
          const fc = pr[14]! + pr[15]! * lF;
          const w = (Math.PI * fc) / SR;
          const g = w * (1 + (w * w) / 3);
          const kk = 2 - 2 * pr[16]!;
          a1 = 1 / (1 + g * (g + kk));
          a2 = g * a1;
          a3 = g * a2;
          fcSet = true;
        }
        const v3 = mix - ic2;
        const v1 = a1 * ic1 + a2 * v3;
        const v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1;
        ic2 = 2 * v2 - ic2;
        if (sA === 1) {
          lA += pr[17]!;
          if (lA >= 1) {
            lA = 1;
            sA = 2;
          }
        } else if (sA === 2) lA = pr[19]! + (lA - pr[19]!) * pr[18]!;
        else if (sA === 3) {
          lA *= pr[20]!;
          if (lA < 1e-5) {
            lA = 0;
            sA = 0;
          }
        }
        const out = v2 * lA * pr[21]!;
        outL[base + i]! += out * l;
        outR[base + i]! += out * r;
      }
    }
    st[0] = p0;
  }
}

const SECONDS = 4;
const frames = Math.round((SECONDS * SR) / BLOCK) * BLOCK;

export function patchRun(variant: "interp" | "fused", runs = 5): number[] {
  const once = () => {
    const L = new Float64Array(frames),
      R = new Float64Array(frames);
    const t = performance.now();
    if (variant === "interp") runInterp(Float64Array, L, R);
    else runFused(Float64Array, L, R);
    return ((performance.now() - t) * 1e6) / (frames * VOICES);
  };
  once();
  return Array.from({ length: runs }, once);
}
