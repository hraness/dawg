/**
 * Agent tools for sample packs: `list_packs`, `search_sounds`, `use_sound`.
 * `use_sound` resolves and fetches the sound first (a `prepare` plan), then
 * commits ordinary score operations so it is one undo step like any edit.
 */
import { SCORE_LIMITS } from "../../core/score.ts";
import {
  PackError,
  PackStore,
  banksOf,
  type Manifest,
} from "../audio/packs.ts";

/** `RolandTR909 (TR909)`: banks with their Strudel nickname, if any. */
async function kitsWithNicknames(
  packs: PackStore,
  pack: string,
  manifest: Manifest,
): Promise<string[]> {
  const aliases = await packs.bankAliases(pack);
  return banksOf(manifest).map((bank) => {
    const nickname = aliases.nicknames.get(bank);
    return nickname ? `${bank} (${nickname})` : bank;
  });
}
import { useSound } from "../commands/pack.ts";
import type { AgentTool } from "./tools.ts";

/** Thrown for arguments the pack tools refuse. */
export class PackToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackToolError";
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function store(context: { packs?: PackStore }): PackStore {
  return context.packs ?? defaultStore();
}

let shared: PackStore | undefined;
function defaultStore(): PackStore {
  shared ??= new PackStore();
  return shared;
}

function bounded(value: unknown): string {
  const text = JSON.stringify(value);
  return text.length <= 24_000 ? text : `${text.slice(0, 24_000)}…`;
}

export const PACK_TOOLS: readonly AgentTool[] = Object.freeze([
  {
    name: "list_packs",
    description:
      "List the sample packs dawg can use (Strudel-format manifests: drum machines, Dirt-Samples, VCSL, General MIDI soundfonts, …) with license and, for one pack, its kits and sounds.",
    parameters: {
      type: "object",
      properties: {
        pack: {
          type: "string",
          maxLength: 64,
          description: "A pack name to list its kits and sounds.",
        },
      },
      additionalProperties: false,
    },
    plan(args) {
      const name = typeof args.pack === "string" ? args.pack.trim() : "";
      return {
        kind: "action",
        summary: name ? `pack ${name}` : "list packs",
        run: async (context) => {
          const packs = store(context);
          if (!name) {
            const list = await packs.list();
            return {
              content: bounded({
                ok: true,
                packs: list.map((pack) => ({
                  name: pack.name,
                  title: pack.title,
                  license: pack.license,
                })),
                hint: "search_sounds finds sounds; use_sound puts one on a track",
              }),
              summary: `${list.length} packs`,
            };
          }
          const info = await packs.info(name);
          if (!info)
            throw new PackToolError(`no pack named ${name.slice(0, 40)}`);
          const manifest = await packs.manifest(info.name);
          const sounds = [...manifest.sounds]
            .slice(0, 300)
            .map(([sound, entry]) =>
              entry.kind === "zones"
                ? `${sound} (keyed, ${entry.zones.length} notes)`
                : `${sound} (${entry.files.length})`,
            );
          return {
            content: bounded({
              ok: true,
              pack: info.name,
              license: info.license,
              ...(info.attribution ? { attribution: info.attribution } : {}),
              kits: await kitsWithNicknames(packs, info.name, manifest),
              sounds,
              total: manifest.sounds.size,
            }),
            summary: `${info.name} · ${manifest.sounds.size} sounds`,
          };
        },
      };
    },
  },
  {
    name: "search_sounds",
    description:
      "Search pack sounds by name (e.g. 'bd', '909 hh', 'piano', 'gm guitar'). Returns pack:<pack>/<sound> refs for use_sound; keyed sounds are pitched instruments.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 80 },
        pack: { type: "string", maxLength: 64 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    plan(args) {
      if (typeof args.query !== "string" || !args.query.trim())
        throw new PackToolError("query must be a non-empty string");
      const query = args.query.trim().slice(0, 80);
      const pack = typeof args.pack === "string" ? args.pack.trim() : undefined;
      const limit =
        typeof args.limit === "number" && Number.isInteger(args.limit)
          ? Math.max(1, Math.min(100, args.limit))
          : 30;
      return {
        kind: "action",
        summary: `search sounds ${query}`,
        run: async (context) => {
          const matches = await store(context).search(query, {
            ...(pack ? { pack } : {}),
            limit,
          });
          return {
            content: bounded({ ok: true, matches }),
            summary: `${matches.length} sounds for ${query}`,
          };
        },
      };
    },
  },
  {
    name: "use_sound",
    description:
      'Put a pack sound on a track through the sampler. sound is <pack>/<sound>[:<n>] (n picks a file, like Strudel s("bd:3")), a kit/bank name or Strudel bank nickname (909, 808, linn, TR909, tr808, sp12, dmx, RolandTR909, tidal-drum-machines/RolandTR707) to load a whole drum kit, or a keyed instrument such as gm/gm_acoustic_grand_piano or piano/piano. The file is fetched and pinned by sha256 so renders stay reproducible. Drum hits on the track keep playing the matching kit voice.',
    parameters: {
      type: "object",
      properties: {
        sound: { type: "string", minLength: 1, maxLength: 200 },
        trackId: {
          type: "string",
          maxLength: SCORE_LIMITS.maxIdLength,
          description:
            "Target track id (created when missing). Defaults to the focused track.",
        },
        voice: {
          type: "string",
          maxLength: 32,
          description: "Oneshot voice name (default from the sound, e.g. bd).",
        },
        mode: { type: "string", enum: ["auto", "keyed", "oneshot"] },
      },
      required: ["sound"],
      additionalProperties: false,
    },
    plan(args, context) {
      if (typeof args.sound !== "string" || !args.sound.trim())
        throw new PackToolError("sound must be <pack>/<sound> or a kit name");
      const sound = args.sound.trim();
      const trackId =
        typeof args.trackId === "string" && args.trackId
          ? args.trackId
          : context.focusedTrackId;
      if (!ID_PATTERN.test(trackId))
        throw new PackToolError(
          "trackId must be 1-64 letters, digits, dot, dash, or underscore",
        );
      const voice = typeof args.voice === "string" ? args.voice : undefined;
      const mode =
        args.mode === "keyed" || args.mode === "oneshot" ? args.mode : "auto";
      return {
        kind: "prepare",
        summary: `use ${sound}`,
        run: async (action) => {
          try {
            const result = await useSound(
              store(action),
              context.score,
              trackId,
              sound,
              {
                ...(voice ? { voice } : {}),
                mode,
              },
            );
            return {
              kind: "score",
              operations: result.operations,
              summary: result.summary,
              trackId: result.trackId,
            };
          } catch (error) {
            if (error instanceof PackError)
              throw new PackToolError(error.message);
            throw error;
          }
        },
      };
    },
  },
]);
