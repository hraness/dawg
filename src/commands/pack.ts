/**
 * `/pack list|add <url>|info <name>|remove <name>|use <pack>/<sound>` and
 * `/kit [bank]`: Strudel-style sample packs on dawg tracks.
 *
 * The score edits here are pure and return `ScoreOperation`s, so the window
 * (`src/main.ts`) and the agent tools (`use_sound`) share them. Fetching and
 * pinning live in `src/audio/packs.ts`.
 */
import {
  SAMPLER_INSTRUMENT,
  isSamplerInstrument,
  parsePackRef,
  samplerVoiceSlots,
  type Sampler,
  type SampleRef,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { drumVoiceForPitch, isDrumInstrument } from "../../core/drums.ts";
import {
  DEFAULT_KIT,
  DEFAULT_KITS,
  PackError,
  banksOf,
  kitFromBank,
  pinInstrument,
  pinKit,
  type PackInfo,
  type PackStore,
} from "../audio/packs.ts";

export type PackCommand =
  | Readonly<{ kind: "list" }>
  | Readonly<{ kind: "add"; source: string; name?: string }>
  | Readonly<{ kind: "info"; name: string }>
  | Readonly<{ kind: "remove"; name: string }>
  | Readonly<{ kind: "use"; sound: string; voice?: string }>
  | Readonly<{ kind: "usage"; message: string }>;

export const PACK_USAGE =
  "/pack list · /pack add <url|github:user/repo[/branch]> [as <name>] · /pack info <name> · /pack remove <name> · /pack use <pack>/<sound>[:<n>] [as <voice>]";

/** Parses `/pack …`; undefined when the command is not `/pack`. */
export function parsePackCommand(command: string): PackCommand | undefined {
  const match = command.trim().match(/^\/packs?(?:\s+(.*))?$/i);
  if (!match) return undefined;
  const words = (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
  const verb = (words[0] ?? "list").toLowerCase();
  const rest = words.slice(1);
  const named = (): { value?: string; as?: string } => {
    const at = rest.findIndex((word) => word.toLowerCase() === "as");
    if (at === -1) return rest[0] ? { value: rest[0] } : {};
    return {
      ...(rest[0] && at > 0 ? { value: rest[0] } : {}),
      ...(rest[at + 1] ? { as: rest[at + 1] } : {}),
    };
  };
  if (verb === "list" || verb === "ls") return { kind: "list" };
  if (verb === "add") {
    const { value, as } = named();
    if (!value)
      return {
        kind: "usage",
        message: `pack · add needs a manifest URL · ${PACK_USAGE}`,
      };
    return as
      ? { kind: "add", source: value, name: as }
      : { kind: "add", source: value };
  }
  if (verb === "info" || verb === "show") {
    if (!rest[0])
      return {
        kind: "usage",
        message: `pack · info needs a pack name · ${PACK_USAGE}`,
      };
    return { kind: "info", name: rest[0] };
  }
  if (verb === "remove" || verb === "rm") {
    if (!rest[0])
      return {
        kind: "usage",
        message: `pack · remove needs a pack name · ${PACK_USAGE}`,
      };
    return { kind: "remove", name: rest[0] };
  }
  if (verb === "use") {
    const { value, as } = named();
    if (!value)
      return {
        kind: "usage",
        message: `pack · use needs <pack>/<sound> · ${PACK_USAGE}`,
      };
    return as
      ? { kind: "use", sound: value, voice: as }
      : { kind: "use", sound: value };
  }
  return {
    kind: "usage",
    message: `pack · unknown ${verb.slice(0, 20)} · ${PACK_USAGE}`,
  };
}

export type KitCommand =
  Readonly<{ kind: "set"; bank: string }> | Readonly<{ kind: "list" }>;

/** `/kit [bank]` (default kit) and `/kit list`; undefined for other commands. */
export function parseKitCommand(command: string): KitCommand | undefined {
  const match = command.trim().match(/^\/kit(?:\s+(\S+))?\s*$/i);
  if (!match) return undefined;
  const bank = match[1];
  if (bank && /^(list|ls)$/i.test(bank)) return { kind: "list" };
  return { kind: "set", bank: bank ?? DEFAULT_KIT };
}

/** `pack:x/y`, `x/y`, `x/y:3` → `pack:x/y[:n]`; undefined when malformed. */
export function normalizeSoundRef(value: string): string | undefined {
  const src = value.startsWith("pack:") ? value : `pack:${value}`;
  return parsePackRef(src) ? src : undefined;
}

// ---------------------------------------------------------------------------
// Score edits

/**
 * Operations that give `trackId` the sampler `next`, keeping its hits on the
 * same sound where the new sampler has one: drum tracks map GM pitches to
 * drum voice names (kick, snare, …), oneshot samplers map by voice name.
 * Creates the track when it does not exist.
 */
export function samplerOperations(
  score: TrackScore,
  trackId: string,
  next: Sampler,
  name?: string,
): ScoreOperation[] {
  const track = score.tracks.find((item) => item.id === trackId);
  if (!track)
    return [
      {
        type: "addTrack",
        track: {
          id: trackId,
          name: name ?? trackId,
          instrument: SAMPLER_INSTRUMENT,
          sampler: next,
        },
      },
    ];
  const operations: ScoreOperation[] = [
    {
      type: "updateTrack",
      trackId,
      patch: { instrument: SAMPLER_INSTRUMENT, sampler: next },
    },
  ];
  if (next.mode !== "oneshot") return operations;
  const newSlots = samplerVoiceSlots(next);
  let voiceAt: (pitch: number) => string | undefined;
  if (isDrumInstrument(track.instrument))
    voiceAt = (pitch) => drumVoiceForPitch(pitch);
  else if (
    isSamplerInstrument(track.instrument) &&
    track.sampler?.mode === "oneshot"
  ) {
    const byPitch = new Map<number, string>();
    for (const [voice, slot] of samplerVoiceSlots(track.sampler))
      byPitch.set(slot, voice);
    voiceAt = (pitch) => byPitch.get(pitch);
  } else return operations;
  for (const note of score.notes) {
    if (note.trackId !== trackId) continue;
    const voice = voiceAt(note.pitch);
    const slot = voice === undefined ? undefined : newSlots.get(voice);
    if (slot !== undefined && slot !== note.pitch)
      operations.push({
        type: "updateNote",
        noteId: note.id,
        patch: { pitch: slot },
      });
  }
  return operations;
}

/**
 * Where `/kit` lands: the focused track when it is a drum kit, a sampler or
 * empty; otherwise undefined (a melodic track keeps its notes).
 */
export function kitTarget(
  score: TrackScore,
  focusedId: string,
): string | undefined {
  const track = score.tracks.find((item) => item.id === focusedId);
  if (!track) return focusedId;
  if (
    isDrumInstrument(track.instrument) ||
    isSamplerInstrument(track.instrument)
  )
    return focusedId;
  return score.notes.some((note) => note.trackId === focusedId)
    ? undefined
    : focusedId;
}

/** The focused sampler's voices plus `voice` → `ref` (oneshot). */
export function withVoice(
  score: TrackScore,
  trackId: string,
  voice: string,
  ref: SampleRef,
): Sampler {
  const track = score.tracks.find((item) => item.id === trackId);
  const previous =
    track &&
    isSamplerInstrument(track.instrument) &&
    track.sampler?.mode === "oneshot"
      ? track.sampler
      : undefined;
  return Object.freeze({
    ...(previous ?? {}),
    mode: "oneshot",
    voices: Object.freeze({ ...(previous?.voices ?? {}), [voice]: ref }),
  });
}

/** A sampler voice name from a sound (`RolandTR909_bd:2` → `bd_2`). */
export function voiceNameForSound(sound: string, n: number | string): string {
  const base = (
    sound.includes("_") ? sound.slice(sound.lastIndexOf("_") + 1) : sound
  )
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 24);
  const stem = base || "sound";
  return n === 0
    ? stem
    : `${stem}_${String(n)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")}`.slice(0, 32);
}

// ---------------------------------------------------------------------------
// Use a sound (window and agent)

export type UseSoundResult = Readonly<{
  operations: ScoreOperation[];
  trackId: string;
  summary: string;
  /** Packs whose sounds the edit pins (for credits). */
  license: string;
}>;

/**
 * Pins a pack sound onto a track. A keyed sound (note zones, e.g.
 * `gm/gm_acoustic_grand_piano`, `piano/piano`) makes the track a keyed
 * instrument; a bank name (`tidal-drum-machines/RolandTR909`, or a `/kit`
 * name) makes it a drum kit; anything else adds one oneshot voice.
 */
export async function useSound(
  store: PackStore,
  score: TrackScore,
  trackId: string,
  sound: string,
  options: Readonly<{
    voice?: string;
    mode?: "auto" | "keyed" | "oneshot";
  }> = {},
): Promise<UseSoundResult> {
  const kitName = sound.replace(/^pack:/, "");
  if (!kitName.includes("/") || DEFAULT_KITS[kitName.toLowerCase()])
    return useKit(store, score, trackId, kitName);
  const src = normalizeSoundRef(sound);
  const ref = src ? parsePackRef(src) : undefined;
  if (!ref)
    throw new PackError(`${sound.slice(0, 80)} · use <pack>/<sound>[:<n>]`);
  const manifest = await store.manifest(ref.pack);
  const entry =
    manifest.sounds.get(ref.sound) ??
    [...manifest.sounds].find(
      ([key]) => key.toLowerCase() === ref.sound.toLowerCase(),
    )?.[1];
  if (!entry) {
    if (
      banksOf(manifest).some(
        (bank) => bank.toLowerCase() === ref.sound.toLowerCase(),
      )
    )
      return useKit(store, score, trackId, ref.sound, ref.pack);
    throw new PackError(
      `${ref.pack} has no sound ${ref.sound} · search_sounds or /pack info ${ref.pack}`,
    );
  }
  const pack = (await store.info(ref.pack)) as PackInfo;
  const keyed =
    options.mode === "keyed" ||
    (options.mode !== "oneshot" && entry.kind === "zones");
  if (keyed) {
    const sampler = await pinInstrument(ref.pack, ref.sound, store);
    return {
      operations: samplerOperations(score, trackId, sampler, ref.sound),
      trackId,
      summary: `${trackId} plays ${ref.pack}/${ref.sound} · ${Object.keys(sampler.voices).length} zones · ${pack.license}`,
      license: pack.license,
    };
  }
  const pinned = await store.pin(ref);
  const voice = options.voice ?? voiceNameForSound(ref.sound, ref.n);
  if (!/^[a-z][a-z0-9_]{0,31}$/.test(voice))
    throw new PackError(
      `voice "${voice.slice(0, 40)}" is not a valid name · use a-z, 0-9 and _`,
    );
  const sampler = withVoice(score, trackId, voice, pinned);
  return {
    operations: samplerOperations(score, trackId, sampler),
    trackId,
    summary: `${voice} on ${trackId} · ${pinned.src} · ${pack.license}`,
    license: pack.license,
  };
}

/** `/kit <bank>` on a track: pins one oneshot voice per drum voice. */
export async function useKit(
  store: PackStore,
  score: TrackScore,
  trackId: string,
  bank: string,
  packName?: string,
): Promise<UseSoundResult> {
  const kit = await kitFromBank(
    bank,
    store,
    packName ? { pack: packName } : {},
  );
  if (!kit || (packName && kit.pack !== packName))
    throw new PackError(
      `no kit ${bank.slice(0, 40)} · /kit list shows banks (909, 808, linn, RolandTR909, …)`,
    );
  const sampler = await pinKit(kit, store);
  const missing = ["kick", "snare", "hat"].filter(
    (voice) => !kit.voices.has(voice as never),
  );
  return {
    operations: samplerOperations(score, trackId, sampler, "drums"),
    trackId,
    summary: `kit ${kit.bank || kit.pack} on ${trackId} · ${kit.voices.size} voices${missing.length ? ` · no ${missing.join("/")}` : ""} · ${kit.pack} (${kit.license})`,
    license: kit.license,
  };
}

/** Lines for `/pack list`. */
export function packListLines(packs: readonly PackInfo[]): string[] {
  return packs.map(
    (pack) =>
      `${pack.name} · ${pack.license} · ${pack.title}${pack.builtin ? "" : ` · ${pack.source}`}`,
  );
}
