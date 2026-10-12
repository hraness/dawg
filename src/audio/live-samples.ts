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
