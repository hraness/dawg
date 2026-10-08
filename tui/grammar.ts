/**
 * The shared key grammar: one vocabulary for every picker, editor and menu,
 * the one-line footer hint each screen shows, and the `?` panel listing the
 * keys of the current screen.
 *
 *   ↑↓ (j k)        move              Enter   open or confirm
 *   ←→ (h l, - +)   adjust a value    Space   audition or toggle
 *   /               filter            Esc     back one level (filter first)
 *   ?               keys for this screen
 *   digits          type a value, only where a value is focused
 *
 * Play mode is the one exception (its letters are piano keys, by the
 * GarageBand "Musical Typing" convention); its panel says so.
 */
import { displayWidth } from "./text.ts";

/** A `key  action` pair for the `?` panel. */
export type KeyRow = readonly [keys: string, action: string];
export type KeySection = Readonly<{ title: string; rows: readonly KeyRow[] }>;

/**
 * Fit a ` a · b · esc back · ? keys ` hint into `width` columns by dropping
 * parts from the middle: the way out (`esc …`) and `? keys` stay longest,
 * since they are how a user leaves or learns the rest. Returns "" when not
 * even `? keys` fits.
 */
export function fitHint(hint: string, width: number): string {
  const key = `${width}\u0000${hint}`;
  const cached = fitted.get(key);
  if (cached !== undefined) return cached;
  const text = fitHintUncached(hint, width);
  if (fitted.size > 256) fitted.clear();
  fitted.set(key, text);
  return text;
}

/** Hints repeat every frame; fit each (hint, width) once. */
const fitted = new Map<string, string>();

function fitHintUncached(hint: string, width: number): string {
  const parts = hint
    .trim()
    .split(" · ")
    .filter((part) => part.length > 0);
  if (parts.length === 0) return "";
  const tailAt = parts.findIndex(
    (part) => part.startsWith("esc ") || part.startsWith("? "),
  );
  const head = tailAt < 0 ? parts.slice(0, -1) : parts.slice(0, tailAt);
  const tail = tailAt < 0 ? parts.slice(-1) : parts.slice(tailAt);
  for (;;) {
    const text = ` ${[...head, ...tail].join(" · ")} `;
    if (displayWidth(text) <= width) return text;
    if (head.length > 0) head.pop();
    else if (tail.length > 1) tail.shift();
    else return "";
  }
}

/** The ASCII spelling of a hint, for terminals without Unicode arrows. */
export function asciiHint(hint: string): string {
  return hint
    .replace(/↑↓/g, "up/dn")
    .replace(/←→/g, "lt/rt")
    .replace(/–/g, "-");
}

// ── footer hints, one per screen ──────────────────────────────────────

export const HINTS = {
  list: " ↑↓ move · enter choose · / filter · esc back · ? keys ",
  preview: " ↑↓ preview · enter apply · / filter · esc back · ? keys ",
  hover: " ↑↓ hear · enter choose · a A/B · c context · esc back · ? keys ",
  audition:
    " ↑↓ hear · enter keep · space loop · a A/B · c mix · / filter · esc back · ? keys ",
  filtering: " type to filter · enter choose · esc clear · ? keys ",
  menu: " ↑↓ move · enter open · / filter · esc back · ? keys ",
  value: " ←→ adjust · enter type · x reset · esc back · ? keys ",
  point: " ←→ adjust · enter type · x delete · esc back · ? keys ",
  action: " ↑↓ move · enter apply · / filter · esc back · ? keys ",
  typing: " type a value · enter apply · esc cancel ",
  euclid:
    " ↑↓ voice · ←→ adjust · tab field · space loop · x off · esc back · ? keys ",
  text: " ↑↓ scroll · pgup pgdn page · esc back · ? keys ",
  log: " ↑↓ scroll · / filter · esc back · ? keys ",
  keys: " any key closes ",
} as const;

// ── the `?` panel ─────────────────────────────────────────────────────

/** The audition loop's keys, shared by the menu and the rhythm editor. */
const AUDITIONING: readonly KeySection[] = [
  {
    title: "auditioning",
    rows: [
      ["space", "loop the focused track · again stops"],
      ["c", "solo ↔ in context (the whole mix)"],
      ["a", "A/B: committed ↔ staged"],
      ["enter", "keep staged changes (one undo step)"],
      ["esc", "revert staged changes"],
    ],
  },
  {
    title: "every change",
    rows: [
      ["", "while looping, stages; otherwise runs the command shown"],
      ["ctrl-z", "undoes it"],
    ],
  },
];

const LIST: readonly KeyRow[] = [
  ["↑ ↓  j k", "move"],
  ["pgup pgdn", "page"],
  ["enter", "choose"],
  ["/", "filter (type, then enter or esc)"],
  ["esc", "clear the filter, then back"],
];

export const KEYS = {
  prompt: [
    {
      title: "start here",
      rows: [
        ["type + enter", "ask for a change in plain words, or a command"],
        ["ctrl-p", "play notes on the keyboard (chords: q)"],
        [
          "ctrl-k",
          "menu: sound, effects, rhythm, chords, performance, mix, master",
        ],
        ["space", "play / pause (empty prompt)"],
        ["/help", "what dawg can do · /help <topic> for more"],
      ],
    },
    {
      title: "prompt",
      rows: [
        ["enter", "send"],
        ["shift-enter ctrl-j", "new line"],
        ["alt-enter ctrl-q", "queue after the current request"],
        ["ctrl-z ctrl-y", "undo / redo"],
        ["ctrl-o", "transcript"],
        ["esc", "cancel the agent · close a panel"],
        ["ctrl-c", "quit"],
      ],
    },
    {
      title: "mouse",
      rows: [
        ["click ▶/⏸ BPM", "play / pause"],
        ["click track name", "track list (click one to focus it)"],
        ["click model", "model picker"],
        ["volume · fx filter", "a bare param opens its fader drawer"],
      ],
    },
  ],
  list: [{ title: "list", rows: LIST }],
  audition: [
    {
      title: "auditioning list",
      rows: [
        ["space", "loop the focused track · again stops"],
        ["↑ ↓  j k", "move; while looping, hear the row on the loop"],
        ["a", "A/B: before ↔ the highlighted row"],
        ["c", "solo ↔ in context (the whole mix)"],
        ["enter", "keep it (one undo step)"],
        ["esc", "back; nothing changes"],
        ["/", "filter (type, then enter or esc)"],
      ],
    },
  ],
  preview: [
    {
      title: "patterns",
      rows: [
        ["↑ ↓  j k", "move and hear the pattern"],
        ["enter", "apply it to the focused track"],
        ...LIST.slice(3),
      ],
    },
  ],
  menu: [
    {
      title: "menu",
      rows: [
        ["↑ ↓  j k", "move"],
        ["enter → l", "open a section"],
        ["esc ← h", "back one level"],
        ["/", "filter this level"],
      ],
    },
    {
      title: "on a value",
      rows: [
        ["← →  h l  - +", "adjust"],
        ["0-9", "type a value, enter applies"],
        ["enter", "type a value · pick from a list"],
        ["space", "toggle on/off (elsewhere: hear the track)"],
        ["x  delete", "reset to default (deletes an automation point)"],
        ["enter (number)", "open its fader drawer"],
      ],
    },
    {
      title: "mouse",
      rows: [
        ["click", "select a row · click again opens it"],
        ["wheel", "move through the list"],
      ],
    },
    ...AUDITIONING,
  ],
  fader: [
    {
      title: "fader drawer",
      rows: [
        ["← →  - +", "step the value (staged, heard on the loop)"],
        ["shift-← →  { }", "coarse step (five)"],
        ["[ ]  alt-← →", "fine step (a tenth)"],
        ["pgup pgdn", "big step (twenty)"],
        ["home end", "minimum / maximum"],
        ["0-9 .", "type an exact value, enter sets it"],
        ["0  d", "back to the default"],
        ["↑ ↓  tab shift-tab", "next / previous param of this device"],
        ["enter", "keep every staged change (one undo step)"],
        ["esc", "revert and close"],
        ["space  a  c", "loop · A/B · solo ↔ in context"],
      ],
    },
    {
      title: "mouse",
      rows: [
        ["click [−] [+]", "step (shift-click: coarse)"],
        ["click / drag bar", "set the value there"],
        ["wheel on a fader", "step it (shift: coarse)"],
        ["click an option", "choose it"],
        ["[keep] [revert]", "same as enter / esc"],
      ],
    },
  ],
  euclid: [
    {
      title: "rhythm editor",
      rows: [
        ["↑ ↓  j k", "voice"],
        ["← →  h l  - +", "adjust the field"],
        ["tab shift-tab  ] [", "next / previous field"],
        ["0-9", "type a value, enter applies"],
        ["enter", "add a row (or type a value)"],
        ["x", "turn the row off"],
        ["f", "freeze into plain hits"],
        ["esc", "back"],
      ],
    },
    ...AUDITIONING,
  ],
  text: [
    {
      title: "panel",
      rows: [
        ["↑ ↓  j k", "scroll"],
        ["pgup pgdn home end", "page"],
        ["esc", "close"],
      ],
    },
  ],
  guide: [
    {
      title: "guides",
      rows: [
        ["↑ ↓  j k", "move · scroll a guide"],
        ["→ l enter", "expand a section, then open the guide"],
        ["← h", "collapse · go to the parent · back from a guide"],
        ["/", "filter by title and text (enter opens)"],
        ["esc", "clear the filter, then back, then close"],
        ["f1", "open or close the guides"],
      ],
    },
  ],
  log: [
    {
      title: "transcript",
      rows: [
        ["↑ ↓", "scroll"],
        ["pgup pgdn home end", "page"],
        ["/", "next filter: all, requests, ops, errors"],
        ["esc ctrl-o", "close"],
      ],
    },
  ],
  play: [
    {
      title: "play mode · letters are piano keys",
      rows: [
        ["a s d f g h j k l ; '", "white keys"],
        ["w e t y u o p", "black keys"],
        ["z x", "octave down / up"],
        ["c v", "velocity down / up"],
        ["shift · tab", "sustain while held · sustain latch"],
        ["space", "play / pause (with count-in)"],
        ["r · R", "record · record replacing"],
        ["m", "metronome click"],
        ["i", "scale degrees ⇄ chromatic (home row in key)"],
        ["q", "chord mode: auto ⇄ manual"],
        ["/", "type a command, still in play mode"],
        ["ctrl-k", "menu"],
        ["esc", "leave play mode"],
      ],
    },
  ],
  chords: [
    {
      title: "chord mode · number row latches",
      rows: [
        ["1 2 3 4", "dim · min · maj · sus (two combine)"],
        ["5 6 7 8", "add 6 · m7 · M7 · 9"],
        ["0", "clear the latches"],
        ["- =", "voicing down / up"],
        ["9", "next perform mode (block, strum, arp…)"],
        ["b", "next bass mode"],
        ["n", "play the suggested next chord"],
        ["q", "auto (chords fit the key) ⇄ manual"],
      ],
    },
  ],
} satisfies Record<string, readonly KeySection[]>;

export type KeyScreen = keyof typeof KEYS;

/** `?` panel lines: a heading per section, then aligned `keys  action`. */
export function keyLines(sections: readonly KeySection[]): string[] {
  const column =
    Math.max(
      0,
      ...sections.flatMap((section) =>
        section.rows.map(([keys]) => displayWidth(keys)),
      ),
    ) + 2;
  const lines: string[] = [];
  for (const section of sections) {
    if (lines.length) lines.push("");
    lines.push(`── ${section.title}`);
    for (const [keys, action] of section.rows)
      lines.push(
        `${keys}${" ".repeat(Math.max(1, column - displayWidth(keys)))}${action}`,
      );
  }
  return lines;
}
