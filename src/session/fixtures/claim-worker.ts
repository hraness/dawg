import { addNote, createScore, scoreFromJSON } from "../../../core/score.ts";
import { attachTrack, withTrack } from "../attach.ts";
import { openSessionPort } from "../port.ts";
import { ensureSession } from "../store.ts";

/**
 * Test worker: opens a session window in its own process the way `dawg`
 * does (session port, then an atomic claim), prints what it got, and on
 * "edit" materializes a draft track with one note. Stays open until stdin
 * closes so its presence keeps the track focused.
 */
const [workspace, sessionId] = process.argv.slice(2);
type Composition = ReturnType<ReturnType<typeof createScore>["toJSON"]>;
const { paths, record: initialRecord } = await ensureSession<Composition>(
  createScore({ tracks: [] }).toJSON(),
  { workspace: workspace!, sessionId: sessionId! },
);
const port = await openSessionPort<Composition>({
  paths,
  sessionId: sessionId!,
  label: "worker",
  focusedTrackId: null,
  daemonArgs: ["--grace-ms", "300"],
});
let record = port.mode === "daemon" ? await port.load() : initialRecord;
const lines = console[Symbol.asyncIterator]();
process.stdout.write("ready\n");
await lines.next(); // "go": every worker claims at the same moment.
const attached = await attachTrack(
  port,
  scoreFromJSON(record.composition),
  undefined,
);
process.stdout.write(
  `${JSON.stringify({ mode: port.mode, trackId: attached.trackId, draft: attached.draft })}\n`,
);
for (;;) {
  const line = await lines.next();
  if (line.done || line.value === "quit") break;
  if (line.value === "edit") {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      record = await port.load();
      const score = withTrack(
        scoreFromJSON(record.composition),
        attached.trackId,
      );
      const next = addNote(score, {
        id: `${attached.trackId}-n`,
        trackId: attached.trackId,
        startTick: 0,
        durationTicks: 240,
        pitch: 60,
        velocity: 0.8,
      });
      try {
        record = await port.append(
          record,
          { kind: "score.operation", payload: {} },
          next.toJSON(),
        );
        break;
      } catch {
        await Bun.sleep(10);
      }
    }
    process.stdout.write(`edited ${record.revision}\n`);
  }
}
await port.close();
process.exit(0);
