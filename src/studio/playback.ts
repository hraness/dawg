import type { TrackScore } from "../../core/score.ts";

export type DraftRange = Readonly<{
  from: number;
  to: number;
  trackIds: readonly string[];
}>;

/** A small musical draft, rather than the first placeholder or isolated hit. */
export function coherentDraftRange(score: TrackScore): DraftRange | undefined {
  const solo = score.tracks.some((track) => track.solo && !track.muted);
  const tracks = score.tracks.filter(
    (track) => !track.muted && track.volume > 0 && (!solo || track.solo),
  );
  const bar = score.beatsPerBar;
  for (let from = 0; from < score.bars * bar; from += bar) {
    const to = Math.min(score.bars * bar, from + bar * 2);
    if (to - from < bar * 2) continue;
    const active = tracks.filter((track) => {
      const notes = score.notes.filter(
        (note) =>
          note.trackId === track.id &&
          note.velocity > 0 &&
          note.startTick / score.ticksPerBeat < to &&
          (note.startTick + note.durationTicks) / score.ticksPerBeat > from,
      );
      return (
        notes.length >= 2 &&
        notes.some((note) => note.startTick / score.ticksPerBeat >= from + bar)
      );
    });
    if (
      active.length >= 2 &&
      active.some((track) => track.instrument !== "kit")
    )
      return { from, to, trackIds: active.map((track) => track.id) };
  }
  return undefined;
}

export type AutoplayTicket = Readonly<{ generation: number; control: number }>;

/** Late render completions can never undo a person's pause, seek, or new turn. */
export class DraftAutoplay {
  private generation = 0;
  private control = 0;
  private active = false;
  private offered = false;
  private startControl = 0;
  private pausedByListener = false;

  begin(newSong = false): void {
    if (newSong) this.pausedByListener = false;
    this.generation += 1;
    this.active = true;
    this.offered = false;
    this.startControl = this.control;
  }
  end(): void {
    this.active = false;
  }
  humanControl(action: "play" | "pause" | "seek" = "pause"): void {
    this.control += 1;
    if (action !== "seek") this.pausedByListener = action === "pause";
  }
  capture(): AutoplayTicket {
    return { generation: this.generation, control: this.control };
  }
  mayStart(): boolean {
    return (
      this.active &&
      !this.pausedByListener &&
      this.startControl === this.control
    );
  }
  offer(playing: boolean): AutoplayTicket | undefined {
    if (
      !this.active ||
      this.pausedByListener ||
      this.offered ||
      playing ||
      this.startControl !== this.control
    )
      return undefined;
    this.offered = true;
    return { generation: this.generation, control: this.control };
  }
  current(ticket: AutoplayTicket): boolean {
    return (
      ticket.generation === this.generation && ticket.control === this.control
    );
  }
  retry(ticket: AutoplayTicket): void {
    if (this.current(ticket)) this.offered = false;
  }
}
