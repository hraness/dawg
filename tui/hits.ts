/**
 * Click targets, recorded by the same paint code that draws them: every
 * frame rebuilds the list, so hit-testing can never drift from the screen.
 * Later regions sit on top (an overlay paints after what it covers).
 */

export type HitTarget =
  /** A row of the open picker (or the menu), by index into its items. */
  | { kind: "picker-row"; index: number }
  /** The header's transport pill (play / pause). */
  | { kind: "transport" }
  /** The header's track name (the track list). */
  | { kind: "tracks" }
  /** The header's model pill (`/model`). */
  | { kind: "model" }
  /** A fader's step buttons, by field index in the drawer. */
  | { kind: "fader-step"; field: number; direction: 1 | -1 }
  /** A fader bar: `x` columns from `left` map onto min…max. */
  | { kind: "fader-bar"; field: number; left: number; width: number }
  /** A fader's row (label and value): focuses that field. */
  | { kind: "fader-row"; field: number }
  /** One option of a choice field. */
  | { kind: "fader-option"; field: number; option: number }
  /** The drawer's keep / revert buttons. */
  | { kind: "fader-keep" }
  | { kind: "fader-revert" }
  /** The piano roll / highway area. */
  | { kind: "highway" }
  /** Scrollable text (`/help`, the transcript, the `?` panel). */
  | { kind: "text" };

export interface HitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  target: HitTarget;
}

export class HitMap {
  readonly regions: HitRegion[] = [];

  add(
    x: number,
    y: number,
    width: number,
    height: number,
    target: HitTarget,
  ): void {
    if (width <= 0 || height <= 0) return;
    this.regions.push({ x, y, width, height, target });
  }

  /** The topmost region under a cell, or undefined. */
  at(x: number, y: number): HitRegion | undefined {
    for (let index = this.regions.length - 1; index >= 0; index -= 1) {
      const region = this.regions[index]!;
      if (
        x >= region.x &&
        x < region.x + region.width &&
        y >= region.y &&
        y < region.y + region.height
      )
        return region;
    }
    return undefined;
  }
}
