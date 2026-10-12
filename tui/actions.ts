import type { AppView, UiState } from "./app.ts";
import type { CellBuffer } from "./screen.ts";
import type { HitMap, HitTarget } from "./hits.ts";
import { displayWidth } from "./text.ts";
import { onBackground } from "./theme.ts";

/** A persistent command shelf: visible controls and exact mouse targets. */
export function paintActions(
  buffer: CellBuffer,
  y: number,
  width: number,
  view: AppView,
  ui: UiState,
  hits: HitMap,
): number {
  const roles = ui.theme.roles;
  const unicode = ui.capabilities.unicode;
  type Action = {
    label: string;
    compact: string;
    active?: boolean;
    target: HitTarget;
    role: "transport" | "loopRule" | "track" | "success" | "borderFocus";
  };
  const rows: Action[][] = [
    [
      {
        label: `${view.score.playing ? (unicode ? "Ⅱ Pause" : "| Pause") : unicode ? "▶ Play" : "> Play"} Space`,
        compact: view.score.playing ? "Pause" : "Play",
        target: { kind: "transport" },
        role: "transport",
      },
      {
        label: "‹ Scene ^←",
        compact: "‹ Scene",
        target: { kind: "scene-step", direction: -1 },
        role: "loopRule",
      },
      {
        label: "Scene › ^→",
        compact: "Scene ›",
        target: { kind: "scene-step", direction: 1 },
        role: "loopRule",
      },
      {
        label: "☰ Menu ^K",
        compact: "Menu ^K",
        target: { kind: "command", command: "/menu" },
        role: "borderFocus",
      },
      {
        label: "♪ Keys ^P",
        compact: "Keys ^P",
        target: { kind: "command", command: "/play" },
        role: "track",
      },
      {
        label: "? Help",
        compact: "? Help",
        target: { kind: "command", command: "/help" },
        role: "borderFocus",
      },
    ],
  ];
  if (view.play)
    rows.push([
      {
        label: "Notes",
        active: view.play.chordMode === "off",
        compact: "Notes",
        target: { kind: "command", command: "/chords off" },
        role: "success",
      },
      {
        label: "Chords q",
        active:
          view.play.chordMode === "auto" || view.play.chordMode === "manual",
        compact: "Chords",
        target: { kind: "command", command: "/menu chords" },
        role: "success",
      },
      {
        label: "Scale",
        active: view.play.degrees === true,
        compact: "Scale",
        target: { kind: "command", command: "/play degrees" },
        role: "success",
      },
      {
        label: "Chromatic",
        active: view.play.degrees === false,
        compact: "Chromatic",
        target: { kind: "command", command: "/play chromatic" },
        role: "track",
      },
      {
        label: "● Record",
        active: view.play.armed,
        compact: "Record",
        target: { kind: "play-key", key: "r" },
        role: "transport",
      },
      {
        label: "Esc Exit",
        compact: "Exit",
        target: { kind: "command", command: "/play off" },
        role: "borderFocus",
      },
    ]);
  if (view.play?.sounds) rows[1] = rows[1]!.slice(4);
  rows.forEach((row, index) => {
    const compact =
      row.reduce(
        (sum, action) =>
          sum + displayWidth(action.label) + 3 + (action.active ? 2 : 0),
        1,
      ) > width;
    buffer.fill(0, y + index, width, 1, roles.panel);
    let x = 1;
    for (const action of row) {
      let label = compact ? action.compact : action.label;
      if (!unicode)
        label = label
          .replaceAll("‹", "<")
          .replaceAll("›", ">")
          .replaceAll("←", "<")
          .replaceAll("→", ">")
          .replaceAll("☰", "=")
          .replaceAll("♪", "k")
          .replaceAll("●", "*");
      const text = ` ${action.active ? (unicode ? "✓ " : "* ") : ""}${label} `;
      const length = displayWidth(text);
      if (x + length >= width) break;
      buffer.text(
        x,
        y + index,
        text,
        onBackground(
          {
            ...(action.active ? roles.selected : roles[action.role]),
            bold: true,
          },
          roles.panel,
        ),
      );
      hits.add(x, y + index, length, 1, action.target);
      x += length + 1;
    }
  });
  return rows.length;
}
