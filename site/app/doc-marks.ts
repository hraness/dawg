/**
 * The docs' marks, mirrored from guides/index.ts (the TUI's `/guide` and
 * `/help` use the same table; site/tests/doc-marks.test.ts fails when the
 * two differ). The symbol carries the meaning; the chip colour repeats it
 * with the site's clip colours, since DESIGN.md keeps colour in blocks.
 */
export type DocRole =
  | "agent"
  | "transport"
  | "loopRule"
  | "track"
  | "success"
  | "warning"
  | "borderFocus"
  | "promptText";

export interface DocMark {
  readonly mark: string;
  readonly ascii: string;
  readonly role: DocRole;
}

export const SECTION_MARKS: Readonly<Record<string, DocMark>> = {
  Ask: { mark: "✦", ascii: "*", role: "agent" },
  "Type it yourself": { mark: "›", ascii: ">", role: "transport" },
  Menu: { mark: "≡", ascii: "=", role: "loopRule" },
  Keys: { mark: "⌃", ascii: "^", role: "track" },
  Next: { mark: "→", ascii: "->", role: "borderFocus" },
};

export const RULE_MARK: DocMark = {
  mark: "──",
  ascii: "--",
  role: "borderFocus",
};

export const NOTE_MARKS: Readonly<Record<"Tip" | "Careful", DocMark>> = {
  Tip: { mark: "✓", ascii: "+", role: "success" },
  Careful: { mark: "!", ascii: "!", role: "warning" },
};

export const CODE_ROLE: DocRole = "promptText";
