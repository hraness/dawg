/**
 * The docs' and navigation marks, defined once: the TUI's `/guide` pane,
 * `/help`, the Ctrl-K breadcrumb and the dawg.sh docs all import this file
 * (the site through `../../guides/marks.ts`). It imports nothing, so a
 * client bundle can take it too.
 */

/**
 * The docs' marks: one symbol per kind of line, shared by the TUI's `/guide`
 * pane, `/help` and the dawg.sh docs. The symbol carries the meaning, so a
 * page reads the same under NO_COLOR, the mono theme and ASCII; color only
 * repeats it. `role` names a tui/theme.ts role and never a knob color
 * (knob1-4 are reserved for the four knobs).
 */
export interface DocMark {
  /** The symbol in a Unicode terminal and on the site. */
  readonly mark: string;
  /** The symbol when the terminal has no Unicode (TERM=dumb). */
  readonly ascii: string;
  readonly role:
    | "agent"
    | "transport"
    | "loopRule"
    | "track"
    | "success"
    | "warning"
    | "borderFocus"
    | "promptText";
}

/** `## <heading>` → its mark. Other headings get the plain rule. */
export const SECTION_MARKS: Readonly<Record<string, DocMark>> = {
  Ask: { mark: "✦", ascii: "*", role: "agent" },
  "Type it yourself": { mark: "›", ascii: ">", role: "transport" },
  Menu: { mark: "≡", ascii: "=", role: "loopRule" },
  Keys: { mark: "⌃", ascii: "^", role: "track" },
  Next: { mark: "→", ascii: "->", role: "borderFocus" },
};

/** A heading with no mark of its own (Mouse, Try). */
export const RULE_MARK: DocMark = {
  mark: "──",
  ascii: "--",
  role: "borderFocus",
};

/** `- Tip: …` and `- Careful: …` bullets. */
export const NOTE_MARKS: Readonly<Record<"Tip" | "Careful", DocMark>> = {
  Tip: { mark: "✓", ascii: "+", role: "success" },
  Careful: { mark: "!", ascii: "!", role: "warning" },
};

/**
 * A typed command (a `code` span): no symbol of its own, so it is drawn
 * bold in this role; where bold is unavailable (TERM=dumb) the backticks
 * stay in the text.
 */
export const CODE_ROLE: DocMark["role"] = "promptText";

/** A theme role a mark may use (never a knob color). */
export type DocRole = DocMark["role"];

/**
 * The Ctrl-K menu's mark, the same as a guide's `## Menu`: the breadcrumb
 * reads `≡ Arrange › range` (ASCII `= Arrange > range`).
 */
export const MENU_MARK: DocMark = SECTION_MARKS.Menu!;

/** Between breadcrumb steps, and the step dropped when room is short. */
export const CRUMB_SEPARATOR = { mark: "›", ascii: ">" } as const;
export const CRUMB_ELISION = { mark: "…", ascii: "..." } as const;

/**
 * A `/help` group heading's mark, by what its rows are, with the same
 * meaning as in a guide: `✦ agent` (the agent's commands), `⌃ keys` (and
 * every screen's key list), `→ topics · help <topic>` (pages to go to next)
 * and `› sound`, `› sound · performance` for everything else (lines to type).
 */
export function helpGroupMark(group: string): DocMark {
  const topic = group.split(" · ")[0]!.trim();
  if (topic === "agent") return SECTION_MARKS.Ask!;
  if (topic === "keys") return SECTION_MARKS.Keys!;
  if (topic === "topics") return SECTION_MARKS.Next!;
  return SECTION_MARKS["Type it yourself"]!;
}
