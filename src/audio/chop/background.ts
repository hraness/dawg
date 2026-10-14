import { withAudioCompute } from "../compute.ts";
import { runChop } from "./run.ts";

/** Agent and TUI hosts share the same file-safety path while DSP leaves their event loop. */
export const runBackgroundChop: typeof runChop = (op, args, context) =>
  withAudioCompute(
    context.signal,
    (compute) => runChop(op, args, { ...context, compute: compute.chop }),
    { retainChopBuffers: true },
  );
