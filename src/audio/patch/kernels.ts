/**
 * Inlined kernels for the fused voice block (fuse.ts): a node's kernel
 * written into the block with its port offsets, state cells and mode as
 * literals, so the per-sample loop reads fixed offsets and never branches
 * on the mode. Each is the kernel in nodes/ statement for statement (same
 * operations, same order), so the bytes do not change; fuse.test.ts holds
 * them to the interpreter.
 *
 * A kernel comes in three parts so fuse.ts can run several nodes in one
 * sample loop: `pre` (block setup, reads only ctl, prev and state),
 * `body` (one sample `i`, reads and writes only index `i` of its ports)
 * and `post` (state write-back). Names written `$x` are the node's own
 * (prefixed per node by `scoped`); the body runs in its own block.
 */
import { Op, type Section } from "./compile.ts";
import { BLOCK } from "./nodes/frame.ts";

/** Offset of slot `s` in a voice frame (stride `BLOCK`, block 0, locals at 0). */
export function voiceAddr(s: number): number {
  return s >= 0 ? s * BLOCK : -(s + 1) * BLOCK;
}

const port = (s: Section, n: number, k: number) =>
  voiceAddr(s.slots[s.slotBase[n]! + k]!);
/** Whether port `k` of node `n` reads the zero block (unwired audio). */
const zero = (s: Section, n: number, k: number) =>
  s.slots[s.slotBase[n]! + k]! === -1;

const HELPERS = `
const TAU = 2 * Math.PI;
function blep(t, dt) {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}
function warp(cutoff, sampleRate) {
  const fc = Math.min(Math.max(cutoff, 1), 0.49 * sampleRate);
  return Math.tan((Math.PI * fc) / sampleRate);
}
function flush(x) {
  return x > 1e-30 || x < -1e-30 ? x : 0;
}
`;

/** Shared helper definitions the inlined kernels call. */
export const KERNEL_HELPERS = HELPERS;

/** A kernel split for loop fusion (see the file comment). */
export type Parts = Readonly<{ pre: string; body: string; post: string }>;

/** Replaces `$name` with the node's own name for it. */
export function scoped(code: string, n: number): string {
  return code.replace(/\$([A-Za-z]\w*)/g, `n${n}_$1`);
}

/** The parts as one standalone block (one sample loop). */
export function standalone(p: Parts): string {
  return `{\n${p.pre}for (let i = 0; i < ${BLOCK}; i += 1) {\n${p.body}}\n${p.post}}\n`;
}

function oscParts(s: Section, n: number): Parts {
  const c = s.ctlBase[n]!;
  const st = s.stBase[n]!;
  const pitch = port(s, n, 0);
  const o = port(s, n, 5);
  // An unwired fm reads the zero block: pitch + 0 steps the same phase.
  const hz = zero(s, n, 3)
    ? `m[${pitch} + i]`
    : `m[${pitch} + i] + m[${port(s, n, 3)} + i]`;
  const wave = s.mode[n]!;
  let pre = `const $ratio = Math.pow(2, ctl[${c + 1}] / 1200) / f.sampleRate;
const $lv0 = prev[${c + 4}];
const $dlv = (ctl[${c + 4}] - $lv0) / ${BLOCK};
let $ph = st[${st}];
`;
  let body = `let dt = (${hz}) * $ratio;
dt = dt > 0.5 ? 0.5 : dt < -0.5 ? -0.5 : dt;
`;
  if (wave === 0)
    body += `m[${o} + i] = Math.sin(TAU * $ph) * ($lv0 + $dlv * (i + 1));\n`;
  else if (wave === 1)
    body += `const adt = dt < 0 ? -dt : dt;\nm[${o} + i] = (2 * $ph - 1 - blep($ph, adt)) * ($lv0 + $dlv * (i + 1));\n`;
  else if (wave === 3)
    body += `m[${o} + i] = (1 - 4 * Math.abs($ph - 0.5)) * ($lv0 + $dlv * (i + 1));\n`;
  else {
    const pw = wave === 2 ? "0.5" : `$pw0 + $dpw * (i + 1)`;
    if (wave !== 2)
      pre += `const $pw0 = prev[${c + 2}];\nconst $dpw = (ctl[${c + 2}] - $pw0) / ${BLOCK};\n`;
    body += `const adt = dt < 0 ? -dt : dt;
const pw = ${pw};
const h = $ph + 1 - pw >= 1 ? $ph - pw : $ph + 1 - pw;
const v = ($ph < pw ? 1 : -1) + blep($ph, adt) - blep(h, adt);
m[${o} + i] = v * ($lv0 + $dlv * (i + 1));
`;
  }
  body += `$ph = $ph + dt;\n$ph = $ph >= 1 ? $ph - 1 : $ph < 0 ? $ph + 1 : $ph;\n`;
  return { pre, body, post: `st[${st}] = $ph;\n` };
}

function svfParts(s: Section, n: number): Parts {
  const c = s.ctlBase[n]!;
  const st = s.stBase[n]!;
  const x = port(s, n, 0);
  const o = port(s, n, 3);
  const mode = s.mode[n]!;
  const out =
    mode === 0
      ? "v2"
      : mode === 1
        ? "input - $k * v1 - v2"
        : mode === 2
          ? "v1"
          : "input - $k * v1";
  return {
    pre: `const $g0 = warp(prev[${c + 1}], f.sampleRate);
const $g1 = warp(ctl[${c + 1}], f.sampleRate);
const $k0 = 2 - 1.94 * prev[${c + 2}];
const $k1 = 2 - 1.94 * ctl[${c + 2}];
const $dg = ($g1 - $g0) / ${BLOCK};
const $dk = ($k1 - $k0) / ${BLOCK};
const $still = $dg === 0 && $dk === 0;
let $ic1 = st[${st}];
let $ic2 = st[${st + 1}];
let $g = $g1;
let $k = $k1;
let $a1 = 1 / (1 + $g * ($g + $k));
let $a2 = $g * $a1;
let $a3 = $g * $a2;
`,
    body: `if (!$still) {
$g = $g0 + $dg * (i + 1);
$k = $k0 + $dk * (i + 1);
$a1 = 1 / (1 + $g * ($g + $k));
$a2 = $g * $a1;
$a3 = $g * $a2;
}
const input = m[${x} + i];
const v3 = input - $ic2;
const v1 = $a1 * $ic1 + $a2 * v3;
const v2 = $ic2 + $a2 * $ic1 + $a3 * v3;
$ic1 = 2 * v1 - $ic1;
$ic2 = 2 * v2 - $ic2;
m[${o} + i] = ${out};
`,
    post: `st[${st}] = flush($ic1);\nst[${st + 1}] = flush($ic2);\n`,
  };
}

function adsrParts(s: Section, n: number): Parts {
  const c = s.ctlBase[n]!;
  const st = s.stBase[n]!;
  const gate = port(s, n, 0);
  const o = port(s, n, 5);
  return {
    pre: `const $attack = ctl[${c + 1}];
const $decay = ctl[${c + 2}];
const $sustain = ctl[${c + 3}];
const $release = ctl[${c + 4}];
const $up = $attack > 0 ? 1 / ($attack * f.sampleRate) : 1;
const $down = $decay > 0 ? (1 - $sustain) / ($decay * f.sampleRate) : 1;
let $stage = st[${st}];
let $level = st[${st + 1}];
let $step = st[${st + 2}];
`,
    body: `if (m[${gate} + i] > 0.5) {
if ($stage === 0 || $stage === 4) $stage = 1;
} else if ($stage >= 1 && $stage <= 3) {
$stage = 4;
$step = $release > 0 ? $level / ($release * f.sampleRate) : $level;
}
if ($stage === 1) {
$level += $up;
if ($level >= 1) { $level = 1; $stage = 2; }
} else if ($stage === 2) {
$level -= $down;
if ($level <= $sustain) { $level = $sustain; $stage = 3; }
} else if ($stage === 3) $level = $sustain;
else if ($stage === 4) {
$level -= $step;
if ($level <= 0) { $level = 0; $stage = 0; }
}
m[${o} + i] = $level;
`,
    post: `st[${st}] = $stage;\nst[${st + 1}] = $level;\nst[${st + 2}] = $step;\n`,
  };
}

function vcaParts(s: Section, n: number): Parts {
  return {
    pre: "",
    body: `m[${port(s, n, 2)} + i] = m[${port(s, n, 0)} + i] * m[${port(s, n, 1)} + i];\n`,
    post: "",
  };
}

function mixParts(s: Section, n: number): Parts {
  const c = s.ctlBase[n]!;
  const [a, b, cc, d, o] = [0, 1, 2, 3, 8].map((k) => port(s, n, k));
  return {
    pre: `const $pa = prev[${c + 4}];
const $pb = prev[${c + 5}];
const $pc = prev[${c + 6}];
const $pd = prev[${c + 7}];
const $da = (ctl[${c + 4}] - $pa) / ${BLOCK};
const $db = (ctl[${c + 5}] - $pb) / ${BLOCK};
const $dc = (ctl[${c + 6}] - $pc) / ${BLOCK};
const $dd = (ctl[${c + 7}] - $pd) / ${BLOCK};
`,
    body: `const r = i + 1;
m[${o} + i] = m[${a} + i] * ($pa + $da * r) + m[${b} + i] * ($pb + $db * r) + m[${cc} + i] * ($pc + $dc * r) + m[${d} + i] * ($pd + $dd * r);
`,
    post: "",
  };
}

function panParts(s: Section, n: number): Parts {
  const c = s.ctlBase[n]!;
  const [x, l, r] = [0, 2, 3].map((k) => port(s, n, k));
  return {
    pre: `const $t0 = ((prev[${c + 1}] + 1) * Math.PI) / 4;
const $t1 = ((ctl[${c + 1}] + 1) * Math.PI) / 4;
const $l0 = Math.cos($t0);
const $r0 = Math.sin($t0);
const $dl = (Math.cos($t1) - $l0) / ${BLOCK};
const $dr = (Math.sin($t1) - $r0) / ${BLOCK};
`,
    body: `const v = m[${x} + i];
m[${l} + i] = v * ($l0 + $dl * (i + 1));
m[${r} + i] = v * ($r0 + $dr * (i + 1));
`,
    post: "",
  };
}

/**
 * The voice boundary node's outputs (run.ts `voiceSources`) for the ports
 * in `used`, as parts: per-voice constants, the gate, the phase ramp and
 * the time since note-on. Reads `voice`, `sr` from the fused block.
 */
export function voiceParts(s: Section, n: number, used: number): Parts {
  let pre = "const $note = voice.note;\nconst $pos = voice.pos;\n";
  let body = "";
  let post = "";
  const value = [
    "$note.pitch",
    "$note.note",
    "",
    "$note.velocity",
    "",
    "voice.random",
    "voice.index",
    "",
  ];
  for (let k = 0; k < 8; k += 1) {
    if (!(used & (1 << k))) continue;
    const o = port(s, n, k);
    if (k === 2) body += `m[${o} + i] = $pos + i < $note.end ? 1 : 0;\n`;
    else if (k === 4) {
      pre += "const $inc = $note.pitch / sr;\nlet $p = voice.phase;\n";
      body += `m[${o} + i] = $p;\n$p += $inc;\nif ($p >= 1) $p -= Math.floor($p);\n`;
      post += "voice.phase = $p;\n";
    } else if (k === 7)
      body += `m[${o} + i] = ($pos - $note.start + i) / sr;\n`;
    else {
      pre += `const $v${k} = ${value[k]};\n`;
      body += `m[${o} + i] = $v${k};\n`;
    }
  }
  return { pre: scoped(pre, n), body: scoped(body, n), post: scoped(post, n) };
}

/**
 * The parts of node `n`'s kernel, names scoped to the node, or null to call
 * its kernel function. Every `pre` reads only ctl and prev cells of block
 * (not sampled) ports, so the node's sampled inputs may settle their
 * control cells after the loop.
 */
export function kernelParts(s: Section, n: number): Parts | null {
  let p: Parts;
  switch (s.op[n]) {
    case Op.Osc:
      p = oscParts(s, n);
      break;
    case Op.Svf:
      p = svfParts(s, n);
      break;
    case Op.Adsr:
      p = adsrParts(s, n);
      break;
    case Op.Vca:
      p = vcaParts(s, n);
      break;
    case Op.Mix:
      p = mixParts(s, n);
      break;
    case Op.Pan:
      p = panParts(s, n);
      break;
    default:
      return null;
  }
  return {
    pre: scoped(p.pre, n),
    body: scoped(p.body, n),
    post: scoped(p.post, n),
  };
}
