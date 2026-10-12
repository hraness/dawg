/** A flat searchable song shelf, with an explicit load action and liner notes. */
import { DEMOS } from "../../core/demos/index.ts";
import { demoDuration } from "../commands/demo.ts";
import type { MenuNode } from "./menu.ts";

export function demoMenuNodes(): MenuNode[] {
  return DEMOS.map((demo) => ({
    kind: "menu",
    id: `demo:${demo.id}`,
    label: demo.title,
    detail: `${demo.style} · ${demo.tempoBpm} BPM · ${demoDuration(demo)}`,
    help: `${demo.description} · ${demo.features.join(" · ")}`,
    build: () => [
      {
        kind: "action",
        label: "load song",
        command: `demo ${demo.id}`,
        help: "replace the current score in one edit · Ctrl-Z restores it · Space plays",
      },
      {
        kind: "action",
        label: "song notes",
        command: `demo info ${demo.id}`,
        help: "song structure, instruments, production techniques and mix decisions",
      },
    ],
  }));
}
