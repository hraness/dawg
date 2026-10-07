import { DaemonClient } from "../client.ts";

/**
 * Test worker: connects to dawgd in its own process, applies `count` addNote
 * operations (rebasing on stale revisions), then reports what it observed.
 */
const [workspace, sessionId, prefix, countText] = process.argv.slice(2);
const count = Number(countText);
const client = await DaemonClient.connect({
  workspace: workspace!,
  sessionId: sessionId!,
  label: prefix!,
  daemonArgs: ["--grace-ms", "300"],
});
const seen = new Set<number>();
let duplicates = 0;
client.subscribe((update) => {
  if (update.type !== "record") return;
  const last = update.record.events.at(-1);
  if (last) {
    if (seen.has(last.revision)) duplicates += 1;
    seen.add(last.revision);
  }
});
const lines = console[Symbol.asyncIterator]();
process.stdout.write("ready\n");
await lines.next(); // "go": both workers start writing at the same moment.
for (let index = 0; index < count; index += 1) {
  const key = `${prefix}-${index}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const result = await client.apply({
      base: client.record.revision,
      kind: "score.operation",
      key,
      payload: { index },
      operations: [
        {
          type: "addNote",
          note: {
            id: key,
            trackId: "main",
            startTick: index * 120,
            durationTicks: 120,
            pitch: 60 + (index % 12),
            velocity: 0.8,
          },
        },
      ],
    });
    if (result.status === "accepted" || result.status === "duplicate") break;
    if (result.status === "rejected") throw new Error(result.message);
    await client.sync();
  }
}
process.stdout.write("done\n");
await lines.next(); // "report": every worker has finished writing.
const record = await client.sync();
process.stdout.write(
  `${JSON.stringify({ revision: record.revision, digest: client.digest, duplicates, seen: seen.size })}\n`,
);
client.close();
process.exit(0);
