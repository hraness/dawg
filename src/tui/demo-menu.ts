/** A flat searchable song shelf, with an explicit load action and liner notes. */
import { DEMOS } from "../../core/demos/index.ts";
import { demoDuration } from "../commands/demo.ts";
import { listShelf, SHELF_PREFIX } from "../commands/shelf.ts";
import type { MenuNode } from "./menu.ts";

export function demoMenuNodes(): MenuNode[] {
  return [
    ...DEMOS.map((demo): MenuNode => ({
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
    })),
    ...shelfNodes(),
  ];
}

/** Your local studies (see src/commands/shelf.ts), read when the menu opens. */
function shelfNodes(): MenuNode[] {
  return listShelf().map((study) => ({
    kind: "menu",
    id: `demo:${SHELF_PREFIX}${study.slug}`,
    label: study.title,
    detail: `${study.style} · local`,
    help: `${study.description} · local study · not part of dawg`,
    build: () => [
      {
        kind: "action",
        label: "load song",
        command: `demo ${SHELF_PREFIX}${study.slug}`,
        help: "replace the current score in one edit · copies its samples into this project · Ctrl-Z restores it",
      },
      {
        kind: "action",
        label: "song notes",
        command: `demo info ${SHELF_PREFIX}${study.slug}`,
        help: "where the study lives and how loading it works",
      },
    ],
  }));
}
