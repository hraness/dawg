/** The style taxonomy is a tree with unique names (quality-08). */

import { describe, expect, test } from "bun:test";
import {
  LEAF_IDS,
  normalizeStyleName,
  ROOT_IDS,
  STYLE_FAMILIES,
  STYLE_TREE,
  styleByName,
  stylePath,
} from "./index.ts";
import { TAXONOMY_ROWS } from "./taxonomy.ts";

describe("style taxonomy", () => {
  test("every id is unique and well formed", () => {
    const ids = TAXONOMY_ROWS.map((row) => row[0]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  test("every node has one existing parent and reaches a tree root", () => {
    const roots = new Set(ROOT_IDS);
    for (const node of STYLE_TREE.values()) {
      if (node.parent === null) {
        expect(roots.has(node.id)).toBe(true);
        continue;
      }
      expect(STYLE_TREE.has(node.parent)).toBe(true);
      const path = stylePath(node.id);
      expect(STYLE_TREE.get(path[0]!)!.parent).toBeNull();
      expect(path.at(-1)).toBe(node.id);
      // No cycles: a path never repeats an id.
      expect(new Set(path).size).toBe(path.length);
      // A node shares its parent's family unless it roots a family of its
      // own (breakbeat-family sits under electronic but belongs to pop).
      if (!roots.has(node.id))
        expect(STYLE_TREE.get(node.parent)!.family).toBe(node.family);
    }
  });

  test("every family root is in the tree and owned by its family", () => {
    for (const family of STYLE_FAMILIES)
      for (const root of family.roots)
        expect(STYLE_TREE.get(root)?.family).toBe(family.key);
  });

  test("every node is reachable from a root and leaves have no children", () => {
    const seen = new Set<string>();
    const walk = (id: string) => {
      seen.add(id);
      for (const child of STYLE_TREE.get(id)!.children) walk(child);
    };
    for (const node of STYLE_TREE.values())
      if (node.parent === null) walk(node.id);
    expect(seen.size).toBe(STYLE_TREE.size);
    for (const id of LEAF_IDS) expect(STYLE_TREE.get(id)!.children).toEqual([]);
  });

  test("titles and aliases collide with no other id, title or alias", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    const claim = (name: string, id: string) => {
      const key = normalizeStyleName(name);
      const prior = owner.get(key);
      if (prior !== undefined && prior !== id)
        clashes.push(`${name}: ${prior} / ${id}`);
      owner.set(key, id);
    };
    for (const node of STYLE_TREE.values()) claim(node.id, node.id);
    for (const node of STYLE_TREE.values())
      for (const name of [node.title, ...node.aliases]) claim(name, node.id);
    expect(clashes).toEqual([]);
  });

  test("every id, title and alias looks up its own node", () => {
    for (const node of STYLE_TREE.values()) {
      expect(styleByName(node.id)).toBe(node.id);
      for (const alias of [node.title, ...node.aliases])
        expect(styleByName(alias)).toBe(node.id);
    }
  });
});
