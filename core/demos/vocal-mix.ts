import type { TrackInput } from "../score.ts";

/** Linear output headroom precedes long-song window quantization. */
export const VOCAL_OUTPUT_HEADROOM = 0.25;
/** Runtime stock takes already peak below 0.501; keep their unmastered preview audible. */
export const NORMALIZED_STOCK_OUTPUT_HEADROOM = 1;
export const WORD_REVERB_MIX = 0.04;
export const WORD_DELAY_MIX = 0.025;
export const WORD_THROW_PEAK = 0.12;

type Balance = Readonly<{ lead: number; bed: number; layers: number }>;
const LEGACY_BALANCE: Balance = { lead: 1.6, bed: 0.78, layers: 0.6 };
/** New normalized stock takes use a small relative move, independently of quiet legacy books. */
const STOCK_BALANCE: Balance = { lead: 1.1, bed: 0.8, layers: 0.6 };
const SONG_BALANCE: Readonly<Record<string, Balance>> = {
  "candy-fault": { lead: 1.35, bed: 0.85, layers: 0.6 },
  "glass-garden": { lead: 2.8, bed: 0.72, layers: 0.45 },
  "night-swim": { lead: 1.4, bed: 0.75, layers: 0.6 },
  "kite-season": { lead: 2.1, bed: 0.72, layers: 0.6 },
  "bubble-wrap": { lead: 1.5, bed: 0.75, layers: 0.6 },
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
      if (!unpitchedOrBass.test(track.id)) fx.orbit = { orbit: 2 };
      return { ...track, fx, fxAutomation };
    }
    // Glitch layers retain the authored effects; words keep a clean insert path.
    delete fx.crush;
    delete fxAutomation["crush-mix"];
    delete fxAutomation["crush-bits"];
    fx.duck = {
      ...track.fx?.duck,
      orbit: 2,
      depth: Math.max(0.55, Number(track.fx?.duck?.depth ?? 0)),
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
