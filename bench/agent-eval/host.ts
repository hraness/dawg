/**
 * The eval host: a temp dawg project driven exactly like the TUI drives it.
 * Tool commits go through the same reducer path main.ts uses (the agent
 * loop validates and dry-runs every call; the host stores `next`), the score
 * is printed to song.ts and tracks/ by the real project sync, and
 * write_file/edit_file are applied back through that sync. The web tools
 * are offline: any fetch is refused, so a run never leaves the machine
 * except for the model requests themselves.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyScoreOperations } from "../../core/diff.ts";
import type { TrackScore } from "../../core/score.ts";
import {
  StaleRevisionError,
  type AgentCommit,
  type AgentHost,
} from "../../src/agent/agent.ts";
import { initProject } from "../../src/project/init.ts";
import { startProjectSync, type ProjectSync } from "../../src/project/sync.ts";
import { typecheckProject } from "../../src/project/typecheck.ts";

export type EvalHostOptions = Readonly<{
  score: TrackScore;
  focusedTrackId: string;
  /** Run tsc after workspace writes like the TUI does (default true). */
  typecheck?: boolean;
}>;

export type EvalHost = Readonly<{
  host: AgentHost;
  root: string;
  score(): TrackScore;
  revision(): number;
  /** Every operation summary committed, in order. */
  log(): readonly string[];
  /** Waits for pending prints, stops the sync and deletes the project. */
  close(): Promise<void>;
}>;

const offlineFetch = async (): Promise<Response> => {
  throw new Error("network is disabled in the agent eval");
};

export async function createEvalHost(
  options: EvalHostOptions,
): Promise<EvalHost> {
  const root = await mkdtemp(join(tmpdir(), "dawg-agent-eval-"));
  await initProject(root);
  let score = options.score;
  let revision = 0;
  const log: string[] = [];
  const sync: ProjectSync = startProjectSync(
    {
      project: root,
      current: () => score,
      async commit(plan, summary) {
        score = applyScoreOperations(score, plan.operations);
        revision += 1;
        log.push(`files.apply: ${summary}`);
        return score;
      },
      card: () => undefined,
      types: () => undefined,
    },
    {
      watch: false,
      debounceMs: 0,
      typecheck: async () => ({ ok: true, diagnostics: [], ms: 0 }),
    },
  );
  // Startup reprints the score (the project was created by dawg).
  sync.scoreChanged(score);
  await sync.flushScore();
  const typecheck = options.typecheck ?? true;

  const host: AgentHost = {
    snapshot: () => ({
      score,
      revision,
      focusedTrackId: options.focusedTrackId,
      recentOperations: log.slice(-8),
    }),
    async commit(change: AgentCommit) {
      if (change.baseRevision !== revision)
        throw new StaleRevisionError(change.baseRevision, revision);
      score = change.next;
      revision += 1;
      log.push(`agent.tool: ${change.toolName} ${change.summary}`);
      sync.scoreChanged(score);
      await sync.flushScore();
      return { revision };
    },
    workspace: { root },
    async onWorkspaceWrite(path) {
      if (!/\.ts$/.test(path)) return;
      const outcome = await sync.checkFiles();
      if (!typecheck) return outcome;
      const types = await typecheckProject(root);
      return [
        outcome,
        types.ok ? "types ✓" : `types ✗ ${types.diagnostics.length}`,
        ...types.diagnostics
          .slice(0, 8)
          .map((d) => `${d.file}:${d.line}:${d.col} ${d.message}`),
      ].join("\n");
    },
    web: {
      fetch: offlineFetch,
      lookup: async () => {
        throw new Error("network is disabled in the agent eval");
      },
      braveApiKey: "",
      gatewayApiKey: "",
      openRouterApiKey: "",
    },
  };

  return {
    host,
    root,
    score: () => score,
    revision: () => revision,
    log: () => log,
    async close() {
      await sync.stop();
      await rm(root, { recursive: true, force: true });
    },
  };
}
