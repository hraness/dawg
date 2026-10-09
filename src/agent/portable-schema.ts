/**
 * Tool parameter schemas as every provider accepts them.
 *
 * dawg writes unions as `type: ["array", "string"]` with `items` beside it.
 * OpenAI and Anthropic accept that, but Gemini (through the AI Gateway)
 * rewrites the union to `anyOf` and leaves `items` outside, then rejects the
 * whole request, so no Gemini model could run a turn. Here each union
 * becomes an `anyOf` whose branches carry only their own keywords, and an
 * array branch always has `items`.
 */

type Schema = Record<string, unknown>;

/** Keywords that belong to one JSON type's branch of a union. */
const BRANCH_KEYWORDS: Readonly<Record<string, readonly string[]>> = {
  array: ["items", "minItems", "maxItems"],
  object: ["properties", "required", "additionalProperties"],
  string: ["enum", "minLength", "maxLength", "pattern"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"],
};
const ALL_BRANCH_KEYWORDS = new Set(Object.values(BRANCH_KEYWORDS).flat());

/** Items for an array branch that declared none: any scalar. */
const ANY_SCALAR_ITEMS: Schema = {
  anyOf: [{ type: "number" }, { type: "string" }, { type: "boolean" }],
};

function isSchema(value: unknown): value is Schema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function branch(type: string, schema: Schema): Schema {
  const out: Schema = { type };
  for (const key of BRANCH_KEYWORDS[type] ?? []) {
    if (!(key in schema)) continue;
    const value = schema[key];
    // An enum only constrains the branch whose type its values have.
    if (key === "enum" && Array.isArray(value)) {
      const kept = value.filter((v) => typeof v === "string");
      if (kept.length > 0) out.enum = kept;
      continue;
    }
    out[key] = value;
  }
  if (type === "array" && out.items === undefined) out.items = ANY_SCALAR_ITEMS;
  return portableSchema(out);
}

/** A copy of `schema` with every type union rewritten as `anyOf`. */
export function portableSchema(schema: unknown): Schema {
  if (!isSchema(schema)) return schema as Schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "properties" && isSchema(value)) {
      out.properties = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, portableSchema(sub)]),
      );
    } else if (
      (key === "items" || key === "additionalProperties") &&
      isSchema(value)
    ) {
      out[key] = portableSchema(value);
    } else if ((key === "anyOf" || key === "oneOf") && Array.isArray(value)) {
      out[key] = value.map(portableSchema);
    } else {
      out[key] = value;
    }
  }
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    const rest: Schema = {};
    for (const [key, value] of Object.entries(out))
      if (key !== "type" && !ALL_BRANCH_KEYWORDS.has(key)) rest[key] = value;
    return { ...rest, anyOf: types.map((type) => branch(type, out)) };
  }
  if (out.type === "array" && out.items === undefined)
    out.items = ANY_SCALAR_ITEMS;
  return out;
}
