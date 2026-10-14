import type { LoopRender } from "./renderer.ts";

/** Sparse, revision-owned monitoring PCM. Never allocates a whole-song buffer. */
export class MonitorBuffer {
  private readonly chunks = new Map<number, Int16Array>();
  private retained = 0;
  public get bytes(): number {
    return this.retained;
  }
  constructor(
    readonly loopFrames: number,
    readonly maxBytes = 16 * 1024 * 1024,
  ) {}
  add(render: LoopRender): void {
    const range = render.monitor;
    if (
      !range ||
      range.loopFrames !== this.loopFrames ||
      render.pcm.byteLength > this.maxBytes
    )
      return;
    const beforeWrap = this.loopFrames - range.startFrame;
    if (beforeWrap > 0 && render.pcm.length / 2 > beforeWrap) {
      // Own each piece separately: evicting one must release its allocation,
      // rather than retaining a larger shared backing buffer through a view.
      this.add({
        ...render,
        pcm: render.pcm.slice(0, beforeWrap * 2),
        frames: beforeWrap,
      });
      this.add({
        ...render,
        pcm: render.pcm.slice(beforeWrap * 2),
        frames: render.frames - beforeWrap,
        monitor: { ...range, startFrame: 0 },
      });
      return;
    }
    const pcm = render.pcm;
    // Adjacent windows share 50 ms. Crossfade their warmed DSP rather than
    // stepping when a held note has to restart beyond the pre-roll's reach.
    const previous = this.at(range.startFrame);
    if (previous && previous.start !== range.startFrame) {
      const overlap = Math.min(pcm.length / 2, previous.end - range.startFrame);
      for (let frame = 0; frame < overlap; frame++) {
        const gain = (frame + 0.5) / overlap;
        for (let channel = 0; channel < 2; channel++) {
          const old =
            previous.pcm[
              (range.startFrame - previous.start + frame) * 2 + channel
            ]!;
          pcm[frame * 2 + channel] = Math.round(
            old * (1 - gain) + pcm[frame * 2 + channel]! * gain,
          );
        }
      }
    }
    const old = this.chunks.get(range.startFrame);
    if (old) this.retained -= old.byteLength;
    this.chunks.delete(range.startFrame);
    this.chunks.set(range.startFrame, pcm);
    this.retained += pcm.byteLength;
    while (this.retained > this.maxBytes) {
      const oldest = this.chunks.entries().next().value!;
      this.chunks.delete(oldest[0]);
      this.retained -= oldest[1].byteLength;
    }
  }
  at(
    frame: number,
  ): { start: number; end: number; pcm: Int16Array } | undefined {
    let found;
    for (const [start, pcm] of this.chunks)
      if (
        frame >= start &&
        frame < start + pcm.length / 2 &&
        (!found || start > found.start)
      )
        found = { start, end: start + pcm.length / 2, pcm };
    return found;
  }
  sample(frame: number, channel: number): number {
    const chunk = this.at(frame);
    return chunk?.pcm[(frame - chunk.start) * 2 + channel] ?? 0;
  }
  /** Missing regions are bounded silence; transport never waits for synthesis. */
  copy(frame: number, frames: number, out: Int16Array, offset = 0): boolean {
    let complete = true;
    for (let done = 0; done < frames;) {
      const current = frame + done;
      const chunk = this.at(current);
      if (!chunk) {
        complete = false;
        let next = frame + frames;
        for (const start of this.chunks.keys())
          if (start > current) next = Math.min(next, start);
        out.fill(0, (offset + done) * 2, (offset + done + next - current) * 2);
        done += next - current;
        continue;
      }
      let end = Math.min(chunk.end, frame + frames);
      // A newer overlapping window owns the crossfade at its beginning.
      for (const start of this.chunks.keys())
        if (start > current) end = Math.min(end, start);
      out.set(
        chunk.pcm.subarray(
          (current - chunk.start) * 2,
          (end - chunk.start) * 2,
        ),
        (offset + done) * 2,
      );
      done += end - current;
    }
    return complete;
  }
}
