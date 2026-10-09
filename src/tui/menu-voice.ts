/**
 * 0.7 Voice menu rows. The contract mounts three groups once (Sound > Voice,
 * Effects > Voice and Sound > browse sounds > Voices) and hides each while
 * every lane's rows are empty. Each lane fills only its own function below.
 */
import type { MenuContext, MenuNode } from "./menu.ts";

/** Sound > Voice: Clips and Lyrics (clips lane). */
export function clipsSoundRows(_context: MenuContext): MenuNode[] {
  return [];
}

/** Sound > Voice: Pitch with trace, detected key and Make notes (pitch lane). */
export function pitchSoundRows(_context: MenuContext): MenuNode[] {
  return [];
}

/** Sound > Voice: Autotune (autotune lane). */
export function autotuneSoundRows(_context: MenuContext): MenuNode[] {
  return [];
}

/** Effects > Voice: Formant (formant lane). */
export function formantEffectRows(_context: MenuContext): MenuNode[] {
  return [];
}

/** Effects > Voice: Vocoder with a Source picker (vocoder lane). */
export function vocoderEffectRows(_context: MenuContext): MenuNode[] {
  return [];
}

/**
 * Sound > browse sounds > Voices: Vocal (clips), Choir, Solo and Throat
 * (sing), Vocoder (vocoder).
 */
export function voicesBrowseGroup(_context: MenuContext): MenuNode[] {
  return [];
}

/** Every Sound > Voice row, in lane order. */
export function voiceSoundRows(context: MenuContext): MenuNode[] {
  return [
    ...clipsSoundRows(context),
    ...pitchSoundRows(context),
    ...autotuneSoundRows(context),
  ];
}

/** Every Effects > Voice row, in lane order. */
export function voiceEffectRows(context: MenuContext): MenuNode[] {
  return [...formantEffectRows(context), ...vocoderEffectRows(context)];
}

/**
 * A sub-menu that exists only while it has rows: `[]` when `rows` is empty,
 * so a group no lane has filled never shows.
 */
export function voiceGroup(
  id: string,
  label: string,
  help: string,
  rows: (context: MenuContext) => MenuNode[],
  context: MenuContext,
): MenuNode[] {
  const now = rows(context);
  if (now.length === 0) return [];
  return [
    {
      kind: "menu",
      id,
      label,
      detail: now.map((row) => row.label).join(" · "),
      help,
      build: rows,
    },
  ];
}
