import type { Section, TrackInput } from "../score.ts";

/** Linear output headroom precedes long-song window quantization. */
export const VOCAL_OUTPUT_HEADROOM = 0.25;
/** Runtime stock takes already peak below 0.501; keep their unmastered preview audible. */
export const NORMALIZED_STOCK_OUTPUT_HEADROOM = 1;
export const WORD_REVERB_MIX = 0.04;
export const WORD_DELAY_MIX = 0.025;
export const WORD_THROW_PEAK = 0.12;
export const VOCAL_DUCK_DEPTH = 0.45;
/**
 * Dense sections bury words that sit fine over a verse bed, so the lead rides
 * up in choruses and drops the way an engineer rides a fader, instead of the
 * whole song carrying the chorus level.
 */
export const CHORUS_RIDE: number = 1.41;
const ridden = /chorus|drop|hook/i;
/** Songs whose choruses carry their own names. */
const SONG_RIDDEN: Readonly<Record<string, RegExp>> = {
  "candy-fault": /^(bright fault|fault return|overload)$/i,
};
/** Pitched backing parts leave a presence pocket for the words instead of ducking whole. */
export const BED_POCKET = { mid: -5, midfreq: 2200 } as const;

type Balance = Readonly<{ lead: number; bed: number; layers: number }>;
/**
 * Lead levels are measured, not guessed: K-weighted lead minus the ducked
 * backing over sung windows lands at +3.5 to +5.5 dB (sparse Glass Garden
 * +7.5), inside the reference vocal clones' -1 to +6.5 dB and as low as the
 * words stay intelligible to whisper in the full mix. The shelf was +7 to +16.
 */
const LEGACY_BALANCE: Balance = { lead: 0.65, bed: 0.78, layers: 0.65 };
/** New normalized stock takes use a small relative move, independently of quiet legacy books. */
const STOCK_BALANCE: Balance = { lead: 1.1, bed: 0.8, layers: 0.6 };
const SONG_BALANCE: Readonly<Record<string, Balance>> = {
  "candy-fault": { ...LEGACY_BALANCE, lead: 0.8 },
  "glass-garden": { ...LEGACY_BALANCE, lead: 0.36 },
  "night-swim": { ...LEGACY_BALANCE, lead: 0.45 },
  "window-seat": { ...LEGACY_BALANCE, lead: 0.5 },
};
const vocalLayer =
  /^(sing|harm|high|dbl|bdbl|chops?|bchops|stut|pix|vlead|vgrain|voc|echo|chant)/;
const unpitchedOrBass =
  /^(kick|snare|clap|hats|perc|sub|bass|sweep|fx|riser|impact|drop|noise|tear)/;

function vocalLead(tracks: readonly TrackInput[]) {
  return tracks.find(
    (track) =>
      ["vox", "vocal", "bvox"].includes(track.id) &&
      track.sampler?.mode === "oneshot",
  );
}

function normalizedStock(lead: TrackInput) {
  return (
    lead.id === "bvox" &&
    Object.values(lead.sampler!.voices).some(
      (ref) => !ref.src.startsWith("pack:"),
    )
  );
}

/** Local normalized books retain the stock generation path's master conditioning. */
export function hasNormalizedStockVocals(
  tracks: readonly TrackInput[],
): boolean {
  const lead = vocalLead(tracks);
  return !!lead && normalizedStock(lead);
}

/** Fixed monitoring restores only the common pre-window attenuation; exports solve their target. */
export function vocalMonitorGain(tracks: readonly TrackInput[]): number {
  const lead = vocalLead(tracks);
  return lead && !normalizedStock(lead)
    ? 20 * Math.log10(1 / VOCAL_OUTPUT_HEADROOM)
    : 0;
}

/** Mixer/FX changes only: authored notes, controls, source slices and form are untouched. */
export function foregroundVocalTracks(
  tracks: readonly TrackInput[],
  songId: string,
  sections: readonly Section[] = [],
  ticksPerBar = 0,
): readonly TrackInput[] {
  const lead = vocalLead(tracks);
  if (!lead) return tracks;
  const stock = normalizedStock(lead);
  const balance = stock
    ? STOCK_BALANCE
    : (SONG_BALANCE[songId] ?? LEGACY_BALANCE);
  const headroom = stock
    ? NORMALIZED_STOCK_OUTPUT_HEADROOM
    : VOCAL_OUTPUT_HEADROOM;
  return tracks.map((track) => {
    const main = track.id === lead.id;
    const layer = !main && (vocalLayer.test(track.id) || !!track.vocoder);
    const gain =
      headroom *
      (main ? balance.lead : balance.bed * (layer ? balance.layers : 1));
    const fx = {
      ...track.fx,
      postgain: { gain: Number(track.fx?.postgain?.gain ?? 1) * gain },
    };
    const fxAutomation = { ...track.fxAutomation };
    if (fxAutomation["postgain-gain"])
      fxAutomation["postgain-gain"] = fxAutomation["postgain-gain"].map(
        (point) => ({ ...point, value: point.value * gain }),
      );
    if (!main) {
      if (!unpitchedOrBass.test(track.id)) {
        fx.orbit = { orbit: 2 };
        const mid = Number(track.fx?.eq?.mid ?? 0);
        if (!layer && mid === 0 && !fxAutomation["eq-mid"])
          fx.eq = { ...track.fx?.eq, ...BED_POCKET };
      }
      return { ...track, fx, fxAutomation };
    }
    // Glitch layers retain the authored effects; words keep a clean insert path.
    const ride = rideLane(
      fx.postgain.gain,
      sections,
      ticksPerBar,
      SONG_RIDDEN[songId] ?? ridden,
    );
    if (ride && !fxAutomation["postgain-gain"])
      fxAutomation["postgain-gain"] = ride;
    delete fx.crush;
    delete fxAutomation["crush-mix"];
    delete fxAutomation["crush-bits"];
    fx.duck = {
      ...track.fx?.duck,
      orbit: 2,
      depth: VOCAL_DUCK_DEPTH,
      attack: 0.6,
      onset: 0.08,
      hold: true,
    };
    return {
      ...track,
      fx,
      fxAutomation,
      ...(track.reverb
        ? {
            reverb: {
              ...track.reverb,
              mix: Math.min(WORD_REVERB_MIX, Number(track.reverb.mix ?? 0)),
            },
          }
        : {}),
      ...(track.delay
        ? {
            delay: {
              ...track.delay,
              mix: Math.min(WORD_DELAY_MIX, Number(track.delay.mix ?? 0)),
            },
          }
        : {}),
      ...(track.delayMixAutomation
        ? { delayMixAutomation: wordThrows(track.delayMixAutomation) }
        : {}),
    };
  });
}

function wordThrows(points: NonNullable<TrackInput["delayMixAutomation"]>) {
  const low = Math.min(...points.map((point) => point.value));
  const high = Math.max(...points.map((point) => point.value));
  const base = Math.min(WORD_DELAY_MIX, low);
  const peak = Math.min(WORD_THROW_PEAK, high);
  return points.map((point) => ({
    ...point,
    value:
      high > low
        ? base + ((point.value - low) / (high - low)) * (peak - base)
        : base,
  }));
}

/** Step lane for the lead's postgain: the base level, raised over ridden sections with one-beat ramps. */
function rideLane(
  base: number,
  sections: readonly Section[],
  ticksPerBar: number,
  pattern: RegExp,
) {
  if (CHORUS_RIDE === 1 || ticksPerBar <= 0) return undefined;
  const ramp = ticksPerBar / 4;
  const points: { tick: number; value: number }[] = [{ tick: 0, value: base }];
  for (const { name, startBar, bars } of [...sections].sort(
    (a, b) => a.startBar - b.startBar,
  )) {
    if (!pattern.test(name)) continue;
    const start = startBar * ticksPerBar;
    const end = (startBar + bars) * ticksPerBar;
    const n = points.length;
    if (n > 2 && start <= points[n - 2]!.tick + ramp) {
      // Adjacent ridden sections (chorus into drop) stay up.
      points[n - 2]!.tick = end;
      points[n - 1]!.tick = end + ramp;
      continue;
    }
    points.push(
      { tick: Math.max(points[n - 1]!.tick, start - ramp), value: base },
      { tick: start, value: base * CHORUS_RIDE },
      { tick: end, value: base * CHORUS_RIDE },
      { tick: end + ramp, value: base },
    );
  }
  return points.length > 1 ? points : undefined;
}
