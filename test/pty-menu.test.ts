/**
 * The edit menu end to end: Ctrl-K opens it, keys alone change an effect
 * parameter and add an automation point, and both land in the session.
 */
import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

type SessionTrack = {
  id: string;
  filter?: { cutoff: number; resonance: number };
  filterAutomation?: { tick: number; value: number }[];
  fx?: Record<string, Record<string, number | string | boolean>>;
  instrument?: string;
  synth?: Record<string, number | string | boolean | number[]>;
  velocityCurve?: { curve: string; fixed?: number };
  humanize?: { timing?: number; velocity?: number; seed: number };
};

/** Tracks in the newest composition record under `.dawg/`. */
async function sessionTracks(cwd: string): Promise<SessionTrack[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    // Lock directories and presence files can vanish mid-walk.
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name.endsWith(".json")) found.push(path);
    }
  };
  await walk(join(cwd, ".dawg"));
  for (const path of found) {
    const text = await readFile(path, "utf8").catch(() => "{}");
    if (!text.includes('"composition"')) continue;
    const parsed = JSON.parse(text) as {
      composition?: { tracks?: SessionTrack[] };
    };
    if (parsed.composition?.tracks) return parsed.composition.tracks;
  }
  return [];
}

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

test.skipIf(!supported)(
  "real PTY: menu changes a filter cutoff and an automation point",
  async () => {
    const t = await launch(100, 30, {});
    const bass = async () =>
      (await sessionTracks(t.cwd)).find((track) => track.id === "bass");
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      expect(t.vt.text()).toContain("Mix");
      // The footer names the keys for this screen.
      expect(t.vt.text()).toContain("enter open");

      // Effects › filter › cutoff, typed as digits.
      await t.send("j");
      await t.send("j");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Effects"), "effects");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("› filter"), "filter");
      // `/` filters the list; the focused row's command shows under it.
      await t.send("/cutoff");
      await t.until(() => t.vt.text().includes("filter · /cutoff"), "filtered");
      await t.until(
        () => t.vt.text().includes("› fx filter cutoff"),
        "command under the list",
      );
      await t.send("\r");
      for (const key of "1200") await t.send(key);
      await t.until(() => t.vt.text().includes("1200"), "typed value");
      // Enter sets the typed value in the fader drawer (staged); a second
      // Enter keeps it.
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("1 change staged"),
        "1200 staged",
      );
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.filter?.cutoff === 1200,
        "filter in session",
      );

      // Back out to the root with Esc, one level each,
      // then Mix › automation › filter cutoff.
      // (Enter in the drawer kept the value and closed it; the list's
      // `/cutoff` filter is still up, so Esc clears it first.)
      await t.until(() => t.vt.text().includes("kept 1 change"), "kept");
      await t.send("\u001b");
      await t.send("\u001b");
      await t.send("\u001b");
      await t.until(() => t.vt.text().includes("Mix"), "back at the root");
      await t.send("/mix");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Mix"), "mix");
      await t.send("/automation");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("Mix › automation"),
        "automation",
      );
      await t.send("/cutoff");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("add points"), "lane menu");
      await t.send("/add");
      await t.send("\r");
      for (const key of "2:800") await t.send(key);
      await t.send("\r");
      await waitFor(async () => {
        const points = (await bass())?.filterAutomation ?? [];
        return points.length === 1 && points[0]!.value === 800;
      }, "automation in session");
      // The new point is listed with its beat and value.
      await t.until(() => t.vt.text().includes("beat 2"), "point row");

      // Esc closes the menu; the prompt takes text again.
      for (let i = 0; i < 8; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
      await t.send("abc");
      await t.until(() => t.vt.text().includes("abc"), "typing");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: menu turns tremolo on and sets its depth",
  async () => {
    const t = await launch(100, 30, {});
    const bass = async () =>
      (await sessionTracks(t.cwd)).find((track) => track.id === "bass");
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/effects");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Effects"), "effects");
      // The core effects lead; the Strudel extras are one level down.
      expect(t.vt.text()).toContain("tremolo");
      expect(t.vt.text()).toContain("more effects");
      await t.send("/tremolo");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("› tremolo"), "tremolo");
      expect(t.vt.text()).toContain("advanced");
      // Enter on "on" turns the effect on with its defaults.
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.fx?.tremolo?.depth === 0.5,
        "tremolo on in session",
      );
      await t.send("/depth");
      await t.send("\r");
      for (const key of "0.8") await t.send(key);
      // Enter sets the typed value in the fader drawer (staged); a second
      // Enter keeps it.
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("1 change staged"),
        "0.8 staged",
      );
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.fx?.tremolo?.depth === 0.8,
        "tremolo depth in session",
      );
      for (let i = 0; i < 4; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: menu loads a synth preset and sets a synth parameter",
  async () => {
    const t = await launch(100, 30, {});
    const bass = async () =>
      (await sessionTracks(t.cwd)).find((track) => track.id === "bass");
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Sound"), "sound");
      await t.send("/preset");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("acid"), "preset list");
      await t.send("/acid");
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.synth?.lpenv !== undefined,
        "acid preset in session",
      );
      // The choice list stays open (menu convention): Esc clears its
      // filter, backs out to Sound, then clears that filter too.
      for (let i = 0; i < 3; i++) await t.send("\u001b");
      await t.until(
        () => t.vt.text().includes("preset           acid"),
        "parameters shows the preset",
      );
      await t.send("/attack");
      await t.send("\r");
      for (const key of "0.2") await t.send(key);
      // Enter sets the typed value in the fader drawer (staged); a second
      // Enter keeps it.
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("1 change staged"),
        "0.2 staged",
      );
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.synth?.attack === 0.2,
        "synth attack in session",
      );
      for (let i = 0; i < 4; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY: Sound › performance sets a velocity curve and humanize",
  async () => {
    const t = await launch(100, 30, {});
    const bass = async () =>
      (await sessionTracks(t.cwd)).find((track) => track.id === "bass");
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await t.send("\u000b");
      await t.until(() => t.vt.text().includes("Project"), "menu root");
      await t.send("/sound");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("≡ Sound"), "sound");
      await t.send("/performance");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("velocity curve"),
        "performance rows",
      );
      await t.send("/velocity");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("hard"), "curve list");
      await t.send("/soft");
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.velocityCurve?.curve === "soft",
        "soft velocity curve in session",
      );
      for (let i = 0; i < 3; i++) await t.send("\u001b");
      await t.until(
        () => t.vt.text().includes("humanize timing"),
        "back on performance",
      );
      await t.send("/humanize timing");
      await t.send("\r");
      for (const key of "12") await t.send(key);
      // In the fader drawer Enter stages the typed value; Enter again keeps.
      await t.send("\r");
      await t.until(() => t.vt.text().includes("±12 ms"), "staged humanize");
      await t.send("\r");
      await waitFor(
        async () => (await bass())?.humanize?.timing === 12,
        "humanize in session",
      );
      for (let i = 0; i < 5; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);

test.skipIf(!supported)(
  "real PTY 80×24: /menu opens topics by id and ← backs out",
  async () => {
    const t = await launch(80, 24, {});
    const open = async (id: string, crumb: string) => {
      await t.send(`/menu ${id}`);
      await t.send("\r");
      await t.until(() => t.vt.text().includes(crumb), `/menu ${id}`);
    };
    const close = async () => {
      for (let i = 0; i < 4; i++) await t.send("\u001b");
      await t.until(() => !t.vt.text().includes("≡ "), "menu closed");
    };
    try {
      await t.until(() => t.vt.text().includes(" NOW "), "prompt");
      await open("voice", "≡ Voice");
      await close();
      await open("tuning", "Chords and key › tuning");
      // ← adjusts a value row; on an action row it goes back, like esc.
      // (k wraps from the first row to the last: "list scales".)
      await t.send("k");
      await t.until(() => t.vt.text().includes("› list scales"), "action row");
      await t.send("\u001b[D");
      await t.until(
        () =>
          t.vt.text().includes("≡ Chords and key") &&
          !t.vt.text().includes("› tuning ─"),
        "back to chords and key",
      );
      await close();
      await open("agent", "Project › agent");
      expect(t.vt.text()).toContain("model key");
      await t.send("h");
      await t.until(
        () =>
          t.vt.text().includes("≡ Project") &&
          !t.vt.text().includes("Project › agent"),
        "h backs out to project",
      );
      await close();
      await open("performance", "Sound › performance");
      expect(t.vt.text()).toContain("humanize timing");
      await close();
      // An unknown id gets a short usage that fits 80 columns, with the
      // nearest name when one is close.
      await t.send("/menu nope");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes('no menu "nope" · /menu <topic or row>'),
        "menu error",
      );
      await t.send("/menu sond");
      await t.send("\r");
      await t.until(
        () => t.vt.text().includes("did you mean /menu sound?"),
        "menu did-you-mean",
      );
      // The keys topic opens the ? panel (§4).
      await t.send("/menu keys");
      await t.send("\r");
      await t.until(() => t.vt.text().includes("╭─ keys"), "keys panel");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  30_000,
);
