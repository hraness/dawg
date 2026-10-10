/**
 * The one command grammar in a real PTY at 80x24, offline (DAWG_AI=0):
 * slash and bare spellings run the same command, aliases run their
 * canonical form, known verbs answer with a usage card instead of reaching
 * the agent, and receipts never claim an edit that did not happen.
 */
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { launch, supported } from "./pty-harness.ts";

test.skipIf(!supported)(
  "real PTY: slash ≡ bare, usage cards and honest receipts",
  async () => {
    const t = await launch(80, 24, { DAWG_AI: "0" }, ["--track", "lead"]);
    const sees = (text: string) => t.vt.text().includes(text);
    const run = async (line: string, expected: string) => {
      await t.send(`${line}\r`);
      await t.until(() => sees(expected), `${line} → ${expected}`);
    };
    try {
      await t.until(() => sees("lead"), "prompt");
      // Bare and slashed spellings are the same command.
      await run("formant 3", "formant · shift 3");
      await run("/fx reverb on", "reverb");
      await run("/euclid hat 7 16", "hat");
      // A value out of range: one template, no raw core key.
      await run("tempo 900", "tempo takes 20…300 BPM");
      expect(t.vt.text()).not.toContain("tempoBpm");
      // A bare scalar opens its fader.
      await run("tempo", "←→ adjust");
      await t.send("\u001b");
      await Bun.sleep(300);
      // An instrument typo is refused, never stored.
      await run("instrument sawtoth", "did you mean sawtooth?");
      // Removing a note that does not exist says so.
      await run("remove n1", "no note n1");
      // Sections: rm is remove.
      await run("bars 8", "8");
      await run("section verse 1-4", "verse");
      await run("section rm verse", "deleted verse");
      // rig <preset> is canonical.
      await run("rig jangle", "rig jangle");
      // The canonical listing spelling reads the chain, never an error.
      await run("fx list", "• fx");
      expect(t.vt.text()).not.toContain("unknown effect list");
      // Synth values out of range name the range.
      await run("synth lpf 99999", "lpf takes 20…20000 Hz");
      // A missing track points at a slash-free listing.
      await run("track rm nope", "no track nope · tracks lists them");
      // Status reads print •.
      await run("sections", "• no sections");
      // swing names where it lives instead of suggesting sing.
      await run("swing", "swing lives on a rhythm row");
      // loop a-b works without a matching section.
      await run("loop 2-3", "loop · bars 2–3");
      // export <file>.wav renders offline in the project directory.
      await t.send("export a.wav\r");
      await t.until(
        () => existsSync(join(t.cwd, "a.wav")) || sees("export ·"),
        "export",
      );
      expect(t.vt.text()).not.toContain("unrecognized");
    } finally {
      t.terminal.write("\u0003");
      await t.proc.exited;
    }
  },
  60_000,
);
