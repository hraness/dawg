/**
 * Which real screens (../docs/screens/<id>.json) sit beside which guide on
 * the web docs. The TUI shows the guide alone; the site adds the screen after
 * the guide's opening paragraph. tests/guide-screens.test.ts checks that every
 * guide and screen named here exists, so a renamed guide or screen fails CI.
 */
export const guideScreens: Readonly<Record<string, readonly string[]>> = {
  "getting-started": ["highway"],
  keys: ["help", "keys"],
  audition: ["menu"],
  play: ["play-mode"],
  sound: ["knobs"],
  mix: ["mix"],
  tape: ["tape"],
  agent: ["agent"],
  "show-me": ["showme"],
  panes: ["panes"],
  audio: ["audio"],
};

/** A guide body split after its opening paragraph, where screens go. */
export function splitIntro(body: string): { intro: string; rest: string } {
  const index = body.search(/\n#{1,6} /u);
  if (index < 0) return { intro: body, rest: "" };
  return { intro: body.slice(0, index), rest: body.slice(index + 1) };
}
