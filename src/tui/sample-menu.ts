/** Local sample shelf. Browsing does not fetch, decode or edit the score. */
import { BUNDLED_SAMPLES } from "../../core/bundled-samples.ts";
import type { MenuNode } from "./menu.ts";

export function sampleLibraryNodes(): MenuNode[] {
  return [
    ...BUNDLED_SAMPLES.map((sample): MenuNode => ({
      kind: "menu",
      id: `sample:${sample.id}`,
      label: sample.title,
      detail: `${sample.seconds}s · ${sample.tags.join(" · ")}`,
      help: `${sample.description} · original CC0 · offline`,
      build: () => [
        {
          kind: "action",
          label: "preview sound",
          command: `/sample preview ${sample.id}`,
          help: "hear the original while playback is paused · no score edits",
        },
        {
          kind: "action",
          label: "add sample track",
          command: `/sample use ${sample.id}`,
          help: "add this sound to an editable track · Ctrl-P plays it from QWERTY",
        },
        ...([4, 8, 16] as const).map((count): MenuNode => ({
          kind: "action",
          label: `chop into ${count}`,
          command: `/sample chop ${sample.id} ${count}`,
          help: `${count} evenly spaced slices with a playable pattern · the original stays intact`,
        })),
      ],
    })),
    {
      kind: "action",
      label: "library notes",
      command: "/sample library all",
      help: "sound descriptions, licensing and reusable sample commands",
    },
    {
      kind: "entry",
      label: "import audio",
      value: "",
      placeholder: "local WAV, AIFF, FLAC, MP3 or OGG path",
      example: "/sample /path/to/audio.wav",
      help: "copy your own audio into the project",
      command: (text) => (text.trim() ? `/sample ${text.trim()}` : undefined),
    },
  ];
}
