/** Window-local return history. Never stores or restores committed score/audio. */
export class NavigationHistory<T> {
  private frames: T[] = [];
  constructor(readonly limit = 24) {}
  get depth(): number {
    return this.frames.length;
  }
  push(frame: T): void {
    this.frames.push(frame);
    if (this.frames.length > this.limit) this.frames.shift();
  }
  back(): T | undefined {
    return this.frames.pop();
  }
  clear(): void {
    this.frames = [];
  }
  snapshot(): readonly T[] {
    return this.frames.slice();
  }
  restore(frames: readonly T[]): void {
    this.frames = frames.slice(-this.limit);
  }
}

/** Terminal-safe chords: no reliance on Command, Alt, or enhanced protocols. */
export const NAVIGATION_ACTIONS = [
  { id: "jump", key: "\u0007", hint: "ctrl-g jump", command: "/jump" },
  { id: "back", key: "\u0002", hint: "ctrl-b back", command: "/back" },
] as const;

export function navigationAction(value: string): "jump" | "back" | undefined {
  return NAVIGATION_ACTIONS.find((action) => action.key === value)?.id;
}
