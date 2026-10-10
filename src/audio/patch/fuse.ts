/**
 * Fused voice blocks: the voice section compiled to one JavaScript function
 * per program (design §8.2, "compile the patch, don't interpret it"). Every
 * input record and port offset is resolved once and written into the code
 * as a literal, and each node calls its kernel directly instead of going
 * through the runner's per-node switch. Consecutive nodes with inlined
 * kernels share one sample loop (each node's statements for sample `i` in
 * node order), split wherever a node reads a whole block (a block
 * control's last sample) that an earlier node in the loop writes. The generated statements are the
 * interpreter's arithmetic in the interpreter's order, so the output is
 * bit-identical to `prologue` + `kernel`.
 */
import {
  Base,
  F,
  In,
  INPUT_WIDTH,
  mapMacro,
  Op,
  type Section,
} from "./compile.ts";
import { BLOCK } from "./nodes/frame.ts";
import {
  KERNEL_HELPERS,
  kernelParts,
  type Parts,
  scoped,
  standalone,
  voiceAddr,
  voiceParts,
} from "./kernels.ts";

export { voiceAddr };

/** Literal for a double, exact (`String` round-trips; -0 needs its sign). */
export function lit(x: number): string {
  if (Object.is(x, -0)) return "(-0)";
  if (x !== x) return "NaN";
  if (x === Infinity) return "Infinity";
  if (x === -Infinity) return "(-Infinity)";
  const s = String(x);
  return x < 0 ? `(${s})` : s;
}

/** Shared state a fused block reads and writes besides the voice memory. */
export type FuseCtx = {
  consts: Float64Array;
  ext: Float64Array;
  scrubbed: number;
};

/** One input record's code, split like a kernel's parts (kernels.ts). */
type InputCode = {
  pre: string;
  body: string;
  post: string;
  /** Slot offsets read whole before the loop (block values, slot bases). */
  blockReads: number[];
  /** Slot offset written per sample, or -1. */
  write: number;
  /** False when the per-sample form does not apply (a sum into its own source). */
  fusable: boolean;
};

/**
 * Code for one input record (the generic prologue specialised to it): audio
 * sums, sampled controls and block controls. `$` names are the record's own
 * (kernels.ts `scoped` prefixes them with the node).
 */
function inputCode(
  section: Section,
  consts: Float64Array,
  record: number,
  first: boolean,
): InputCode {
  const rec = section.inputs;
  const cab = section.cables;
  const r = record * INPUT_WIDTH;
  const kind = rec[r + F.Kind]!;
  const c0 = rec[r + F.CableStart]! * 2;
  const c1 = c0 + rec[r + F.CableCount]! * 2;
  const cables: { x: number; a: string }[] = [];
  for (let c = c0; c < c1; c += 2)
    cables.push({ x: voiceAddr(cab[c]!), a: lit(consts[cab[c + 1]!]!) });
  const q = `$r${record}`;
  if (kind === In.Sum) {
    const o = voiceAddr(rec[r + F.Slot]!);
    // One pass per sample, the sum's terms in cable order (slots are whole
    // blocks, so a source either is the scratch slot or does not overlap).
    if (cables.every((c) => c.x !== o)) {
      const terms = cables.map((c) => `m[${c.x} + i] * ${c.a}`);
      return {
        pre: "",
        body: `m[${o} + i] = ${terms.join(" + ")};\n`,
        post: "",
        blockReads: [],
        write: o,
        fusable: true,
      };
    }
    let code = `for (let i = 0; i < ${BLOCK}; i += 1) m[${o} + i] = m[${cables[0]!.x} + i] * ${cables[0]!.a};\n`;
    for (const c of cables.slice(1))
      code += `for (let i = 0; i < ${BLOCK}; i += 1) m[${o} + i] += m[${c.x} + i] * ${c.a};\n`;
    return {
      pre: code,
      body: "",
      post: "",
      blockReads: [],
      write: -1,
      fusable: false,
    };
  }
  const slot = rec[r + F.Ctl]!;
  const cl = rec[r + F.Clamp]!;
  const lo = cl >= 0 ? lit(consts[cl]!) : "(-Infinity)";
  const hi = cl >= 0 ? lit(consts[cl + 1]!) : "Infinity";
  const bi = rec[r + F.BaseIndex]!;
  const mp = rec[r + F.Map]!;
  const baseKind = rec[r + F.BaseKind]!;
  const blockReads: number[] = [];
  let base: string;
  if (baseKind === Base.Const) base = lit(consts[bi]!);
  else {
    if (baseKind !== Base.External) blockReads.push(voiceAddr(bi));
    const raw =
      baseKind === Base.External
        ? `ctx.ext[${bi}]`
        : `m[${voiceAddr(bi) + BLOCK - 1}]`;
    base =
      mp >= 0
        ? `mapMacro(${raw}, k[${mp}], k[${mp + 1}], k[${mp + 2}] === 1, k[${mp + 3}], k[${mp + 4}])`
        : raw;
  }
  const settle = (value: string) =>
    `{\nlet v = ${value};\nif (v !== v) { v = 0; ctx.scrubbed += 1; }\n` +
    (first ? `prev[${slot}] = v;\n` : `prev[${slot}] = ctl[${slot}];\n`) +
    `ctl[${slot}] = v;\n}\n`;
  if (kind === In.Sampled) {
    const o = voiceAddr(rec[r + F.Slot]!);
    if (cables.every((c) => c.x !== o)) {
      let sum = `${q}base`;
      for (const c of cables) sum = `(${sum}) + m[${c.x} + i] * ${c.a}`;
      const v = cl >= 0 ? `v < ${lo} ? ${lo} : v > ${hi} ? ${hi} : v` : "v";
      return {
        pre: `const ${q}base = ${base};\nlet ${q}last = 0;\n`,
        body: `{\nconst v = ${sum};\nconst w = ${v};\nm[${o} + i] = w;\n${q}last = w;\n}\n`,
        post: settle(`${q}last`),
        blockReads,
        write: o,
        fusable: true,
      };
    }
    let code = `{\nconst base = ${base};\nfor (let i = 0; i < ${BLOCK}; i += 1) m[${o} + i] = base;\n`;
    for (const c of cables)
      code += `for (let i = 0; i < ${BLOCK}; i += 1) m[${o} + i] += m[${c.x} + i] * ${c.a};\n`;
    if (cl >= 0)
      code += `for (let i = 0; i < ${BLOCK}; i += 1) { const v = m[${o} + i]; m[${o} + i] = v < ${lo} ? ${lo} : v > ${hi} ? ${hi} : v; }\n`;
    code += `}\n${settle(`m[${o + BLOCK - 1}]`)}`;
    return {
      pre: code,
      body: "",
      post: "",
      blockReads,
      write: -1,
      fusable: false,
    };
  }
  let code = `{\nlet value = ${base};\n`;
  for (const c of cables) {
    blockReads.push(c.x);
    code += `value += m[${c.x + BLOCK - 1}] * ${c.a};\n`;
  }
  code += `if (value < ${lo}) value = ${lo};\nelse if (value > ${hi}) value = ${hi};\n`;
  code += `${settle("value")}}\n`;
  return {
    pre: code,
    body: "",
    post: "",
    blockReads,
    write: -1,
    fusable: true,
  };
}

/** A fused voice block: one block of the voice section, boundary included. */
export type FusedBlock = (
  f: unknown,
  ctx: FuseCtx,
  voice: unknown,
  sr: number,
) => void;

/** Kernel call for node `n` (null: the runner fills it, or nothing to do). */
export type KernelOf = (op: number, n: number) => string | null;

/**
 * Builds the fused block of a voice section: `first` evaluates every input
 * (the voice's first block), otherwise only the hot ones.
 * The voice boundary node is inlined for the ports in `deps.voiceUsed`
 * (kernels.ts `voiceParts`). Kernels come from `deps` by the names `kernelOf` returns.
 */
export function fuseVoice(
  section: Section,
  consts: Float64Array,
  first: boolean,
  kernelOf: KernelOf,
  deps: Readonly<Record<string, unknown>>,
): FusedBlock {
  const rec = section.inputs;
  let body = "";
  // The open group: nodes sharing one sample loop, and the slots they write.
  let group: Parts[] = [];
  let written = new Set<number>();
  const close = () => {
    if (group.length === 1) body += standalone(group[0]!);
    else if (group.length > 1)
      body += `{\n${group.map((g) => g.pre).join("")}for (let i = 0; i < ${BLOCK}; i += 1) {\n${group.map((g) => `{\n${g.body}}\n`).join("")}}\n${group.map((g) => g.post).join("")}}\n`;
    group = [];
    written = new Set();
  };
  const voiceOp = section.ids.indexOf("voice");
  for (let n = 0; n < section.op.length; n += 1) {
    if (n === voiceOp) {
      group.push(voiceParts(section, n, deps.voiceUsed as number));
      const end =
        n + 1 < section.op.length
          ? section.slotBase[n + 1]!
          : section.slots.length;
      for (let k = section.slotBase[n]!; k < end; k += 1)
        written.add(voiceAddr(section.slots[k]!));
      continue;
    }
    const records: number[] = [];
    if (first) {
      for (let j = 0; j < section.inCount[n]!; j += 1) {
        const record = section.inStart[n]! + j;
        if (rec[record * INPUT_WIDTH + F.Kind] !== In.None)
          records.push(record);
      }
    } else
      for (let j = 0; j < section.hotCount[n]!; j += 1)
        records.push(section.hot[section.hotStart[n]! + j]!);
    const inputs = records.map((record) =>
      inputCode(section, consts, record, first),
    );
    const parts = kernelParts(section, n);
    if (!parts || !inputs.every((x) => x.fusable)) {
      close();
      for (const x of inputs)
        body += scoped(x.body ? standalone(x) : x.pre + x.post, n);
      const call = parts ? standalone(parts) : kernelOf(section.op[n]!, n);
      if (call) body += call + "\n";
      continue;
    }
    // A node joins the open group unless it reads a whole block that the
    // group writes (that block is only complete after the loop).
    if (inputs.some((x) => x.blockReads.some((o) => written.has(o)))) close();
    group.push({
      pre: scoped(inputs.map((x) => x.pre).join(""), n) + parts.pre,
      body: scoped(inputs.map((x) => x.body).join(""), n) + parts.body,
      post: scoped(inputs.map((x) => x.post).join(""), n) + parts.post,
    });
    for (const x of inputs) if (x.write >= 0) written.add(x.write);
    const end =
      n + 1 < section.op.length
        ? section.slotBase[n + 1]!
        : section.slots.length;
    for (let k = section.slotBase[n]! + section.nIn[n]!; k < end; k += 1)
      written.add(voiceAddr(section.slots[k]!));
  }
  close();
  const names = Object.keys(deps);
  const code = `"use strict";\n${KERNEL_HELPERS}\nreturn function fused(f, ctx, voice, sr) {\nconst m = f.m;\nconst st = f.st;\nconst ctl = f.ctl;\nconst prev = f.prev;\nconst k = ctx.consts;\n${body}};`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const make = new Function("mapMacro", ...names, code) as (
    ...a: unknown[]
  ) => never;
  return make(mapMacro, ...names.map((name) => deps[name]));
}
