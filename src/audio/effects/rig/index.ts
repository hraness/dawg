/**
 * The guitar rig stages of the track chain (`fx.stomp`, `fx.head` with its
 * gate, `fx.cab`), mono, after `distort` and before `tremolo`. Each
 * nonlinear section (stomp, head) runs inside one oversampler: 4x at
 * 22.05 kHz, 2x at 44.1/48 kHz. Coefficients follow automation every 32
 * samples, and only when a lane exists. Never per voice.
 */
import type { FxValues } from "../../../../core/fx.ts";
import type { Track } from "../../../../core/score.ts";
import { CONTROL_SAMPLES, fxReader, type EffectContext } from "../common.ts";
import { cabFilters } from "./cab.ts";
import { clamp, dbToGain } from "./filters.ts";
import { applyGate } from "./gate.ts";
import {
  HeadCircuit,
  headMakeup,
  headMakeupAt,
  type HeadSettings,
} from "./head.ts";
import { runSection, sectionFactor } from "./section.ts";
import {
  stompCircuit,
  stompMakeup,
  stompMakeupAt,
  type StompSettings,
} from "./stomp.ts";

function blend(
  buffer: Float64Array,
  dry: Float64Array,
  mix: (index: number) => number,
): void {
  for (let i = 0; i < buffer.length; i += 1) {
    const wet = clamp(mix(i), 0, 1);
    if (wet < 1) buffer[i] = dry[i]! + (buffer[i]! - dry[i]!) * wet;
  }
}

export function applyStomp(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "stomp", values, context);
  const gain = read.param("gain");
  const tone = read.param("tone");
  const mix = read.param("mix");
  const settings: StompSettings = {
    gain: gain.at(0),
    tone: tone.at(0),
    level: read.number("level"),
    octave: read.number("octave"),
  };
  const factor = sectionFactor(context.sampleRate);
  const circuit = stompCircuit(
    read.text("type"),
    settings,
    context.sampleRate * factor,
  );
  const dry =
    mix.automated || mix.at(0) < 1 ? Float64Array.from(buffer) : undefined;
  const automated = gain.automated || tone.automated;
  const type = read.text("type");
  const blocks = automated
    ? new Float64Array(Math.ceil(buffer.length / CONTROL_SAMPLES) + 1)
    : undefined;
  runSection(
    buffer,
    factor,
    (x) => circuit.process(x),
    blocks
      ? (i) => {
          if (i % CONTROL_SAMPLES !== 0) return;
          settings.gain = gain.at(i);
          settings.tone = tone.at(i);
          circuit.set(settings);
          blocks[i / CONTROL_SAMPLES] = stompMakeupAt(
            type,
            settings,
            context.sampleRate,
            factor,
          );
        }
      : undefined,
  );
  if (blocks)
    for (let i = 0; i < buffer.length; i += 1)
      buffer[i] = buffer[i]! * blocks[Math.floor(i / CONTROL_SAMPLES)]!;
  else {
    const makeup = stompMakeup(type, settings, context.sampleRate, factor);
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = buffer[i]! * makeup;
  }
  if (dry) blend(buffer, dry, (i) => mix.at(i));
}

export function applyHead(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "head", values, context);
  const sr = context.sampleRate;
  const gain = read.param("gain");
  const master = read.param("master");
  const gate = values.gate as number | undefined;
  if (gate !== undefined) applyGate(buffer, gate, sr);
  const sag = values.sag as number | undefined;
  const settings: HeadSettings & { gain: number; master: number } = {
    type: read.text("type"),
    gain: gain.at(0),
    bass: read.number("bass"),
    mid: read.number("mid"),
    treble: read.number("treble"),
    presence: read.number("presence"),
    master: master.at(0),
    ...(sag === undefined ? {} : { sag }),
  };
  const factor = sectionFactor(sr);
  const level = dbToGain(read.number("level"));
  const head = new HeadCircuit(settings, sr * factor, factor);
  const automated = gain.automated || master.automated;
  if (!automated) {
    const makeup = headMakeup(settings, sr, factor) * level;
    runSection(buffer, factor, (x) => head.process(x));
    for (let i = 0; i < buffer.length; i += 1) buffer[i] = buffer[i]! * makeup;
    return;
  }
  const blocks = new Float64Array(
    Math.ceil(buffer.length / CONTROL_SAMPLES) + 1,
  );
  runSection(
    buffer,
    factor,
    (x) => head.process(x),
    (i) => {
      if (i % CONTROL_SAMPLES !== 0) return;
      settings.gain = gain.at(i);
      settings.master = master.at(i);
      head.set(settings);
      blocks[i / CONTROL_SAMPLES] = headMakeupAt(settings, sr, factor) * level;
    },
  );
  for (let i = 0; i < buffer.length; i += 1)
    buffer[i] = buffer[i]! * blocks[Math.floor(i / CONTROL_SAMPLES)]!;
}

export function applyCab(
  buffer: Float64Array,
  track: Track,
  values: FxValues,
  context: EffectContext,
): void {
  const read = fxReader(track, "cab", values, context);
  const mix = read.param("mix");
  const chain = cabFilters(
    read.text("type"),
    read.number("mic"),
    context.sampleRate,
  );
  const constant = !mix.automated ? clamp(mix.at(0), 0, 1) : undefined;
  for (let i = 0; i < buffer.length; i += 1) {
    const dry = buffer[i]!;
    let x = dry;
    for (const filter of chain) x = filter.process(x);
    const wet = constant ?? clamp(mix.at(i), 0, 1);
    buffer[i] = wet === 1 ? x : dry + (x - dry) * wet;
  }
}
