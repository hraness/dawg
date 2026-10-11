import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyScoreOperations } from "../../core/diff.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { listGuides, parseGuide } from "../../guides/index.ts";
import { AGENT_TOOL_DOCS } from "../agent/tool-docs.ts";
import { AGENT_TOOLS, type ToolContext } from "../agent/tools.ts";
import { chopFromWords } from "../audio/chop/words.ts";
import { parseMediaArgv } from "../media/cli.ts";
import { SUBCOMMANDS } from "../launch-args.ts";
import {
  AGENT_DOCS_INDEX_BYTES,
  AGENTS_BEGIN,
  AGENTS_END,
  agentDocs,
  agentDocsIndex,
  findAgentDoc,
  listRecipes,
  pageSlice,
  parseRecipe,
  recipeExamples,
  renderAgentsMd,
  searchAgentDocs,
  shellWords,
  upsertAgentsMd,
} from "./agent-docs.ts";
import { AGENTS_MD_MAX_BYTES } from "./agents-md.ts";
import { parseDocsArgv, runDocsCommand } from "./cli.ts";

const advertised = AGENT_TOOLS.filter((tool) => !tool.hidden);

function baseScore(): TrackScore {
  return createScore({
    bars: 16,
    tempoBpm: 120,
    tracks: [
      { id: "drums", name: "Drums", instrument: "kit" },
      { id: "bass", name: "Bass", instrument: "bass" },
      { id: "keys", name: "Keys", instrument: "user" },
      { id: "vox", name: "Vox", instrument: "user" },
      { id: "pad", name: "Pad", instrument: "saw" },
    ],
  });
}

function contextFor(score: TrackScore, revision: number): ToolContext {
  return {
    score,
    focusedTrackId: "drums",
    revision,
    newNoteId: (trackId, index) => `${trackId}-${revision}-${index}`,
  };
}

type Schema = {
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** Top-level schema shape: required keys present, no unknown keys. */
function schemaProblems(name: string, args: Record<string, unknown>): string[] {
  const tool = AGENT_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return [`unknown tool ${name}`];
  const schema = tool.parameters as Schema;
  const problems: string[] = [];
  for (const key of schema.required ?? [])
    if (!(key in args)) problems.push(`${name}: missing ${key}`);
  if (schema.additionalProperties === false && schema.properties)
    for (const key of Object.keys(args))
      if (!(key in schema.properties)) problems.push(`${name}: unknown ${key}`);
  return problems;
}

describe("tool reference", () => {
  test("every advertised agent tool has a page with its schema", () => {
    for (const tool of advertised) {
      const page = findAgentDoc(`tool/${tool.name}`);
      expect(page?.kind).toBe("tool");
      expect(page!.body).toContain(tool.description);
      const props = Object.keys((tool.parameters as Schema).properties ?? {});
      for (const prop of props) expect(page!.body).toContain(`- ${prop}`);
    }
  });

  test("AGENT_TOOL_DOCS names only real tools", () => {
    const names = new Set(AGENT_TOOLS.map((tool) => tool.name));
    for (const name of Object.keys(AGENT_TOOL_DOCS))
      expect(names).toContain(name);
  });

  test("the power tools carry details and a valid example", () => {
    for (const name of [
      "comment",
      "history_query",
      "docs",
      "audio",
      "exec",
      "dispatch",
      "inspect",
      "glob",
      "grep",
    ]) {
      const doc = AGENT_TOOL_DOCS[name];
      expect(doc?.details?.length ?? 0).toBeGreaterThan(40);
      expect(doc?.example).toBeDefined();
    }
  });

  test("every documented example passes its tool's schema and planner", () => {
    const score = baseScore();
    for (const [name, doc] of Object.entries(AGENT_TOOL_DOCS)) {
      if (!doc.example) continue;
      const args = doc.example as Record<string, unknown>;
      expect(schemaProblems(name, args)).toEqual([]);
      const tool = AGENT_TOOLS.find((candidate) => candidate.name === name)!;
      expect(() => tool.plan(args, contextFor(score, 1))).not.toThrow();
    }
  });
});

describe("recipes", () => {
  const recipes = listRecipes();

  test("cover chopping, subagents, exec, history and comments", () => {
    const tools = new Set(recipes.flatMap((recipe) => recipe.tools));
    for (const name of [
      "audio",
      "dispatch",
      "exec",
      "history_query",
      "comment",
      "split_stems",
      "transcribe_notes",
      "download_audio",
    ])
      expect(tools).toContain(name);
    expect(recipes.length).toBeGreaterThanOrEqual(6);
  });

  test("frontmatter tools exist and every recipe has examples", () => {
    const names = new Set(advertised.map((tool) => tool.name));
    for (const recipe of recipes) {
      for (const tool of recipe.tools) expect(names).toContain(tool);
      expect(recipeExamples(recipe).length).toBeGreaterThan(0);
    }
  });

  test("every tool example parses and plans, applied in order", () => {
    for (const recipe of recipes) {
      let score = baseScore();
      let revision = 1;
      for (const example of recipeExamples(recipe)) {
        if (example.kind !== "tool") continue;
        expect({
          recipe: recipe.id,
          problems: schemaProblems(example.tool, example.args),
        }).toEqual({ recipe: recipe.id, problems: [] });
        expect(recipe.tools).toContain(example.tool);
        const tool = AGENT_TOOLS.find((t) => t.name === example.tool)!;
        let plan;
        try {
          plan = tool.plan(example.args, contextFor(score, revision));
        } catch (error) {
          throw new Error(`${recipe.id} · ${example.tool}: ${String(error)}`);
        }
        if (plan.kind === "score") {
          score = applyScoreOperations(score, plan.operations);
          revision += 1;
        }
      }
    }
  });

  test("every dawg example is a real subcommand whose argv parses", () => {
    for (const recipe of recipes)
      for (const example of recipeExamples(recipe)) {
        if (example.kind !== "dawg") continue;
        const [bin, sub, ...rest] = example.argv;
        expect(bin).toBe("dawg");
        expect(SUBCOMMANDS).toContain(sub!);
        if (sub === "media" && rest[0] === "chop") {
          const words = rest.slice(1).filter((word, index, all) => {
            const prev = all[index - 1];
            return (
              word !== "--json" &&
              word !== "--track" &&
              prev !== "--track" &&
              word !== "--bpm-of" &&
              prev !== "--bpm-of"
            );
          });
          expect(() => chopFromWords(words)).not.toThrow();
        } else if (sub === "media") {
          expect(() => parseMediaArgv(rest)).not.toThrow();
        } else if (sub === "docs") {
          expect(parseDocsArgv(rest).kind).not.toBe("error");
        }
      }
  });

  test("parseRecipe rejects a missing header", () => {
    expect(() => parseRecipe("no header", "x.md")).toThrow("x.md");
    expect(() =>
      parseRecipe("---\nid: a\ntitle: A\ntools: nope\n---\nbody", "x.md"),
    ).toThrow("tools");
  });

  test("shellWords honours quotes", () => {
    expect(shellWords(`dawg history comment "two words #tag" --json`)).toEqual([
      "dawg",
      "history",
      "comment",
      "two words #tag",
      "--json",
    ]);
  });
});

describe("guides through the agent lens", () => {
  test("```agent blocks leave the human body and reach the guide page", () => {
    const guide = parseGuide(
      "---\nid: demo\ntitle: Demo\norder: 1\n---\nHuman text.\n\n```agent\nUse audio op cut.\n```\n\nMore human text.\n",
    );
    expect(guide.body).toBe("Human text.\n\nMore human text.");
    expect(guide.agentBody).toBe("Use audio op cut.");
  });

  test("every guide has a page; agent notes come first", () => {
    for (const guide of listGuides()) {
      const page = findAgentDoc(`guide/${guide.id}`)!;
      expect(page.kind).toBe("guide");
      if (guide.agentBody)
        expect(page.body.indexOf("## For the agent")).toBeLessThan(
          page.body.indexOf("## Guide"),
        );
    }
    expect(listGuides().some((guide) => guide.agentBody.length > 0)).toBe(true);
  });
});

describe("index, search and paging", () => {
  test("the index fits 2 KiB and lists every recipe", () => {
    const index = agentDocsIndex();
    expect(Buffer.byteLength(index)).toBeLessThanOrEqual(
      AGENT_DOCS_INDEX_BYTES,
    );
    for (const recipe of listRecipes())
      expect(index).toContain(`recipe/${recipe.id}`);
  });

  test("bare names resolve and search finds pages", () => {
    expect(findAgentDoc("audio")?.id).toBe("tool/audio");
    expect(findAgentDoc("chop-a-break")?.id).toBe("recipe/chop-a-break");
    expect(findAgentDoc("nope-nope")).toBeUndefined();
    expect(searchAgentDocs("onsets")).toContain("recipe/chop-a-break");
    expect(searchAgentDocs("zzqx-nothing")).toContain("no docs mention");
  });

  test("pageSlice pages by line and keeps each page bounded", () => {
    const body = Array.from(
      { length: 400 },
      (_, i) => `line ${i} ${"x".repeat(40)}`,
    ).join("\n");
    const first = pageSlice(body, 0, 2048);
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(2048);
    const cursor = Number(/cursor=(\d+)/.exec(first)![1]);
    const second = pageSlice(body, cursor, 2048);
    expect(second.startsWith(`line ${cursor} `)).toBe(true);
    for (const page of agentDocs()) expect(page.body.length).toBeGreaterThan(0);
  });

  test("the docs tool reads the index, a page and a search", async () => {
    const tool = AGENT_TOOLS.find((t) => t.name === "docs")!;
    const run = async (args: Record<string, unknown>) => {
      const plan = tool.plan(args, contextFor(baseScore(), 1));
      if (plan.kind !== "action") throw new Error(plan.kind);
      return (await plan.run({})).content;
    };
    expect(await run({})).toContain("recipe/chop-a-break");
    expect(await run({ page: "recipe/chop-a-break" })).toContain("```tool");
    expect(await run({ search: "dispatch" })).toContain("tool/dispatch");
  });
});

describe("AGENTS.md and dawg docs --agent", () => {
  test("the block fits 6 KiB and upserts without touching user text", () => {
    const block = renderAgentsMd();
    expect(Buffer.byteLength(block)).toBeLessThanOrEqual(AGENTS_MD_MAX_BYTES);
    expect(upsertAgentsMd(undefined)).toBe(block);
    const user = "# Mine\n\nKeep me.\n";
    const appended = upsertAgentsMd(user);
    expect(appended.startsWith(user)).toBe(true);
    expect(upsertAgentsMd(appended)).toBe(appended);
    const stale = `${user}\n${AGENTS_BEGIN}\nold text\n${AGENTS_END}\n\ntail\n`;
    const refreshed = upsertAgentsMd(stale);
    expect(refreshed).toBe(`${user}\n${block}\ntail\n`);
    expect(refreshed).not.toContain("old text");
  });

  test("every dawg command AGENTS.md names parses", () => {
    for (const match of renderAgentsMd().matchAll(/`(dawg [^`]+)`/g)) {
      const [, sub] = shellWords(match[1]!);
      expect(SUBCOMMANDS).toContain(sub!);
    }
  });

  test("dawg docs --agent prints the index, pages and refreshes AGENTS.md", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dawg-docs-"));
    try {
      let out = "";
      let err = "";
      const stdout = { write: (text: string) => (out += text) };
      const stderr = { write: (text: string) => (err += text) };
      expect(
        await runDocsCommand(["docs", "--agent"], dir, stdout, stderr),
      ).toBe(0);
      expect(out).toContain("recipe/");
      out = "";
      expect(
        await runDocsCommand(
          ["docs", "--agent", "tool/comment"],
          dir,
          stdout,
          stderr,
        ),
      ).toBe(0);
      expect(out).toContain("# comment");
      expect(
        await runDocsCommand(
          ["docs", "--agent", "no-such"],
          dir,
          stdout,
          stderr,
        ),
      ).toBe(1);
      expect(await runDocsCommand(["docs"], dir, stdout, stderr)).toBe(2);
      expect(err).toContain("usage");
      await writeFile(join(dir, "AGENTS.md"), "# Mine\n");
      expect(
        await runDocsCommand(
          ["docs", "--agent", "--write"],
          dir,
          stdout,
          stderr,
        ),
      ).toBe(0);
      const written = await readFile(join(dir, "AGENTS.md"), "utf8");
      expect(written.startsWith("# Mine\n")).toBe(true);
      expect(written).toContain(AGENTS_BEGIN);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parseDocsArgv", () => {
    expect(parseDocsArgv(["--agent"])).toEqual({ kind: "index" });
    expect(parseDocsArgv(["--agent", "--search", "slice", "beats"])).toEqual({
      kind: "search",
      query: "slice beats",
    });
    expect(parseDocsArgv(["--agent", "a", "b"]).kind).toBe("error");
    expect(parseDocsArgv(["-h"]).kind).toBe("help");
  });
});
