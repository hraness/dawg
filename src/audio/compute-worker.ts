import { scoreFromJSON, ScoreValidationError } from "../../core/score.ts";
import { renderExportAudio } from "./export-audio.ts";
import { renderResample } from "./resample.ts";
import { renderScorePcm } from "./wav.ts";
import { analyzePcm } from "./preview.ts";
import { measureScore } from "./measure.ts";
import { liveSamplesFromData } from "./live-samples.ts";
import { chopComputations } from "./chop/compute.ts";
import type {
  ComputeTask,
  ComputeReply,
  ChopBufferHandle,
  ChopBufferMemory,
} from "./compute.ts";

declare const self: Worker;

/** Transfer only newly computed results. Caller-owned input/cache buffers stay intact. */
function buffers(
  value: unknown,
  found = new Set<ArrayBuffer>(),
): ArrayBuffer[] {
  if (ArrayBuffer.isView(value) && value.buffer instanceof ArrayBuffer)
    found.add(value.buffer);
  else if (value && typeof value === "object")
    for (const child of Object.values(value)) buffers(child, found);
  return [...found];
}

/** One job's PCM stays here; the input thread forwards small, owner-bound descriptors. */
class ChopBuffers {
  private owner?: string;
  private limitBytes = 0;
  private nextId = 0;
  private arrays = new Map<number, Float32Array>();
  private ids = new WeakMap<Float32Array, number>();
  private backing = new Set<ArrayBufferLike>();
  private retainedBytes = 0;

  configure(owner: string, limitBytes: number): void {
    if (!owner || !Number.isSafeInteger(limitBytes) || limitBytes < 1)
      throw new Error("invalid audio buffer budget");
    if (
      this.owner !== undefined &&
      (owner !== this.owner || limitBytes !== this.limitBytes)
    )
      throw new Error("audio buffer owner changed");
    this.owner = owner;
    this.limitBytes = limitBytes;
  }

  memory(): ChopBufferMemory {
    return {
      retainedBytes: this.retainedBytes,
      buffers: this.arrays.size,
      limitBytes: this.limitBytes,
    };
  }

  clear(): void {
    this.arrays.clear();
    this.ids = new WeakMap();
    this.backing.clear();
    this.retainedBytes = 0;
  }

  resolve(value: unknown): unknown {
    if (
      !value ||
      typeof value !== "object" ||
      ArrayBuffer.isView(value) ||
      value instanceof ArrayBuffer
    )
      return value;
    if ("__dawgAudioBuffer" in value) {
      const handle = value as ChopBufferHandle;
      const array = this.arrays.get(handle.__dawgAudioBuffer);
      if (
        handle.owner !== this.owner ||
        !array ||
        handle.length !== array.length ||
        handle.byteLength !== array.byteLength
      )
        throw new Error("audio buffer is stale or belongs to another job");
      return array;
    }
    if (Array.isArray(value)) return value.map((child) => this.resolve(child));
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, this.resolve(child)]),
    );
  }

  retain(value: unknown): unknown {
    const freshArrays = new Set<Float32Array>();
    const freshBuffers = new Set<ArrayBufferLike>();
    const inspect = (item: unknown): void => {
      if (item instanceof Float32Array) {
        if (!this.ids.has(item)) freshArrays.add(item);
        if (!this.backing.has(item.buffer)) freshBuffers.add(item.buffer);
      } else if (
        item &&
        typeof item === "object" &&
        !ArrayBuffer.isView(item) &&
        !(item instanceof ArrayBuffer)
      ) {
        for (const child of Object.values(item)) inspect(child);
      }
    };
    inspect(value);
    if (this.arrays.size + freshArrays.size > 4096)
      throw new Error(
        "audio worker exceeds its 4096 retained buffer limit; split the input into smaller jobs",
      );
    const additional = [...freshBuffers].reduce(
      (sum, buffer) => sum + buffer.byteLength,
      0,
    );
    if (this.retainedBytes + additional > this.limitBytes)
      throw new Error(
        `audio worker PCM exceeds its ${Math.round(this.limitBytes / 1024 / 1024)} MiB retained buffer limit; shorten the input or split it into smaller clips`,
      );
    // Admission is atomic: a failed result retains none of its newly allocated arrays.
    for (const array of freshArrays) {
      const id = ++this.nextId;
      this.arrays.set(id, array);
      this.ids.set(array, id);
    }
    for (const buffer of freshBuffers) this.backing.add(buffer);
    this.retainedBytes += additional;
    const encode = (item: unknown): unknown => {
      if (item instanceof Float32Array)
        return {
          __dawgAudioBuffer: this.ids.get(item)!,
          owner: this.owner!,
          length: item.length,
          byteLength: item.byteLength,
        } satisfies ChopBufferHandle;
      if (
        !item ||
        typeof item !== "object" ||
        ArrayBuffer.isView(item) ||
        item instanceof ArrayBuffer
      )
        return item;
      if (Array.isArray(item)) return item.map(encode);
      return Object.fromEntries(
        Object.entries(item).map(([key, child]) => [key, encode(child)]),
      );
    };
    return encode(value);
  }
}
const chopBuffers = new ChopBuffers();

self.onmessage = (event: MessageEvent<{ id: number; task: ComputeTask }>) => {
  const { id, task } = event.data;
  try {
    let value: unknown;
    const samples =
      "samples" in task && task.samples
        ? liveSamplesFromData(task.samples)
        : undefined;
    if (task.kind === "export")
      value = renderExportAudio(
        task.score,
        samples,
        task.sampleRate,
        task.cues,
        task.measure,
        task.comment,
      );
    else if (task.kind === "resample")
      value = renderResample(scoreFromJSON(task.score), task.request, samples);
    else if (task.kind === "preview") {
      const audio = renderScorePcm(scoreFromJSON(task.score), {
        sampleRate: task.sampleRate,
        ...(samples ? { samples } : {}),
      });
      value = { ...audio, stats: analyzePcm(audio.pcm, audio.sampleRate) };
    } else if (task.kind === "measure") {
      value = measureScore(scoreFromJSON(task.score), {
        ...task.options,
        ...(samples ? { samples } : {}),
      });
    } else if (task.kind === "chop-memory") value = chopBuffers.memory();
    else if (task.kind === "chop-clear") {
      chopBuffers.clear();
      value = undefined;
    } else {
      if (!Object.hasOwn(chopComputations, task.name))
        throw new Error("unknown audio computation");
      const fn = chopComputations[task.name];
      if (typeof fn !== "function")
        throw new Error("unknown audio computation");
      if (task.retain)
        chopBuffers.configure(task.retain.owner, task.retain.limitBytes);
      value = (fn as (...args: unknown[]) => unknown)(
        ...(chopBuffers.resolve(task.args) as unknown[]),
      );
      if (task.retain) value = chopBuffers.retain(value);
    }
    self.postMessage(
      { id, ok: true, value } satisfies ComputeReply,
      buffers(value),
    );
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      validation:
        error instanceof ScoreValidationError ? error.code : undefined,
    } satisfies ComputeReply);
  }
};
