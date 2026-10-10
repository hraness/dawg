/**
 * The editor's prompt queue: two first-in, first-out lanes.
 *
 * - `now`: lines submitted with Enter, menu and picker picks, and the typed
 *   commands a TAPE gesture echoes. They run ahead of queued follow-ups, in
 *   the order they arrived: `track drums` then `track bass` typed while an
 *   edit is still running ends on bass, and `v v` pastes then jumps twice.
 * - `next`: Alt-Enter follow-ups, which wait for every `now` line.
 *
 * One lane used to take `now` lines at its front (`unshift`), so lines typed
 * faster than they ran came out newest first.
 */
export class PromptQueue {
  private readonly now: string[] = [];
  private readonly next: string[] = [];

  /** Run ahead of queued follow-ups, after earlier `now` lines. */
  runNow(...prompts: readonly string[]): void {
    this.now.push(...prompts);
  }

  /** Run after everything already waiting. */
  runNext(prompt: string): void {
    this.next.push(prompt);
  }

  /** The next prompt to run, `now` lines first. */
  shift(): string | undefined {
    return this.now.shift() ?? this.next.shift();
  }

  get length(): number {
    return this.now.length + this.next.length;
  }
}
