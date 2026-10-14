import { sampleKey, type SampleBank } from "./samples.ts";
import { Wavetable } from "./wavetable.ts";

type TableData = Readonly<{
  name: string;
  id: string;
  spectra: readonly ReturnType<Wavetable["spectrum"]>[];
}>;
export type LiveSampleData = Omit<SampleBank, "wavetables"> & {
  wavetables?: ReadonlyMap<string, TableData>;
};

/**
 * Capture a full bank for a worker without cloning Wavetable's lazy function.
 * Each spectrum is bounded by the table format; yield between frames so a
 * large, previously unread table cannot monopolize input or delay cancellation.
 * Input buffers stay owned by the caller and are cloned by postMessage.
 */
export async function sampleBankData(
  bank: SampleBank,
  signal?: AbortSignal,
): Promise<LiveSampleData> {
  signal?.throwIfAborted();
  const { wavetables, ...samples } = bank;
  if (!wavetables) return samples;
  const tables = new Map<string, TableData>();
  for (const [id, table] of wavetables) {
    const spectra: ReturnType<Wavetable["spectrum"]>[] = [];
    for (let frame = 0; frame < table.frames; frame += 1) {
      signal?.throwIfAborted();
      spectra.push(table.spectrum(frame));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    tables.set(id, { name: table.name, id: table.id, spectra });
  }
  signal?.throwIfAborted();
  return { ...samples, wavetables: tables };
}

/** Only the currently played track can contribute to a live single-note render. */
export function liveTrackSamples(
  bank: SampleBank,
  trackId: string,
): LiveSampleData {
  const prefix = sampleKey(trackId, "");
  const table = bank.wavetables?.get(trackId);
  const ir = bank.irs?.get(trackId);
  return {
    voices: new Map([...bank.voices].filter(([key]) => key.startsWith(prefix))),
    problems: [],
    ...(table
      ? {
          wavetables: new Map([
            [
              trackId,
              {
                name: table.name,
                id: table.id,
                // Wavetable contains a lazy function and cannot be structured-cloned.
                spectra: Array.from({ length: table.frames }, (_, i) =>
                  table.spectrum(i),
                ),
              },
            ],
          ]),
        }
      : {}),
    ...(ir ? { irs: new Map([[trackId, ir]]) } : {}),
  };
}

export function liveSamplesFromData(data: LiveSampleData): SampleBank {
  const { wavetables, ...samples } = data;
  return {
    ...samples,
    ...(wavetables
      ? {
          wavetables: new Map(
            [...wavetables].map(([id, table]) => [
              id,
              new Wavetable(
                table.name,
                table.id,
                table.spectra.length,
                (i) => table.spectra[i]!,
              ),
            ]),
          ),
        }
      : {}),
  };
}

/**
 * Sample banks are immutable snapshots. Send one track's assets once, then
 * reuse them for its next notes. A single retained bank bounds worker memory
 * and preserves request order when tracks/projects change between windows.
 */
export class LiveSampleTransfer {
  private bank: SampleBank | undefined;
  private trackId: string | undefined;
  private version = 0;

  public forTrack(
    bank: SampleBank | undefined,
    trackId: string,
  ): {
    sampleVersion: number;
    samples?: LiveSampleData;
  } {
    if (this.version > 0 && bank === this.bank && trackId === this.trackId)
      return { sampleVersion: this.version };
    this.version += 1;
    this.bank = bank;
    this.trackId = trackId;
    return {
      sampleVersion: this.version,
      ...(bank ? { samples: liveTrackSamples(bank, trackId) } : {}),
    };
  }
}
