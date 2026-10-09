import { describe, expect, test } from "bun:test";

import { portableSchema } from "./portable-schema.ts";
import { chatTools } from "./tools.ts";

function unions(schema: unknown, path = ""): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  if (Array.isArray(schema))
    return schema.flatMap((s, i) => unions(s, `${path}[${i}]`));
  const s = schema as Record<string, unknown>;
  const here: string[] = [];
  if (Array.isArray(s.type)) here.push(`${path} type union`);
  if (s.type === "array" && s.items === undefined)
    here.push(`${path} no items`);
  if (s.anyOf !== undefined && ("items" in s || "properties" in s))
    here.push(`${path} keywords beside anyOf`);
  return [
    ...here,
    ...Object.entries(s).flatMap(([k, v]) => unions(v, `${path}.${k}`)),
  ];
}

describe("portable tool schemas", () => {
  test("a union with items becomes anyOf branches that carry their own keywords", () => {
    expect(
      portableSchema({
        description: "stops",
        type: ["array", "string", "null"],
        items: { type: "string" },
        maxItems: 4,
        enum: ["plenum", "full"],
      }),
    ).toEqual({
      description: "stops",
      anyOf: [
        { type: "array", items: { type: "string" }, maxItems: 4 },
        { type: "string", enum: ["plenum", "full"] },
        { type: "null" },
      ],
    });
  });

  test("nested unions and bare arrays are rewritten; plain schemas are unchanged", () => {
    expect(
      portableSchema({
        type: "object",
        properties: {
          params: {
            type: "object",
            additionalProperties: { type: ["number", "array"] },
          },
          name: { type: "string", maxLength: 8 },
        },
        required: ["name"],
      }),
    ).toEqual({
      type: "object",
      properties: {
        params: {
          type: "object",
          additionalProperties: {
            anyOf: [
              { type: "number" },
              {
                type: "array",
                items: {
                  anyOf: [
                    { type: "number" },
                    { type: "string" },
                    { type: "boolean" },
                  ],
                },
              },
            ],
          },
        },
        name: { type: "string", maxLength: 8 },
      },
      required: ["name"],
    });
  });

  test("every serialized tool is free of type unions and itemless arrays (Gemini rejects both)", () => {
    const tools = chatTools();
    expect(tools.length).toBeGreaterThan(40);
    expect(
      tools.flatMap((t) => unions(t.function.parameters, t.function.name)),
    ).toEqual([]);
  });
});
