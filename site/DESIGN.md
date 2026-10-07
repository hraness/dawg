---
name: dawg public marketing
description: A dark terminal on warm paper. The highway's lanes, hit line and track accents carry the page.
colors:
  background: "palette --background (Rosé Pine, light or dark)"
  surface: "palette --surface (pillar cells, table heads)"
  ink: "palette --foreground"
  secondary-ink: "palette --muted"
  action: "palette --primary"
  terminal-bg: "rgb(24 28 37), the TUI default theme panel, in both modes"
  terminal-fg: "rgb(225 231 239)"
  lane-accents: "#eb6f92, #f6c177, #9ccfd8, #c4a7e7 (track accents, in order)"
  lane-rule: "color-mix(in oklab, var(--foreground) 9%, transparent)"
typography:
  display:
    fontFamily: "Nebula Sans (var(--font-text))"
    fontSize: "clamp(2.4rem, 6vw, 4rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.03em"
  wordmark:
    fontFamily: "var(--font-mono)"
    use: "the word dawg in the hero and header"
  body:
    fontFamily: "Nebula Sans (var(--font-text))"
    lineHeight: 1.55
  mono:
    fontFamily: "var(--font-mono)"
    use: "commands, terminal surfaces, eyebrows, step counters"
rounded:
  terminal: "0.7rem"
  code: "0.55rem"
  cells: "0.8rem (pillar grid)"
spacing:
  measure: "72rem"
  gutter: "clamp(1rem, 4vw, 2.5rem)"
  section: "clamp(3rem, 7vw, 5rem)"
---

## Overview

dawg.sh is built with the shared Hraness packages: `@hraness/design-kit` (palette system, marketing header, fonts, not-found page), `@hraness/ui` (copy button, buttons), `@hraness/site-footer` (network footer), `@hraness/web-discovery` (share cards) and `@hraness/posthog` (analytics). The palette is Rosé Pine, selectable from the appearance menu like every Hraness site.

The identity comes from the product's own screen. The terminal is the only dark surface, and it stays dark in light mode because it shows real frames in the TUI's default theme. Everything around it is quiet paper, so the eye goes to the highway.

## Colors

- Page colors come from palette tokens only (`--background`, `--surface`, `--foreground`, `--muted`, `--primary`, `--line`).
- The four lane accents are the TUI's track accents. They mark the pillars, the three-window mock and the drum lanes, in that order, and appear nowhere else.
- Terminal surfaces (hero demo, code blocks, mini windows) use the fixed terminal colors in both modes.

## Typography

- Nebula Sans for prose and headings. The word “dawg” in the hero is set in mono, in the primary color, because it is the command you type.
- Mono for every command, key, flag and terminal surface, and for small uppercase eyebrows.

## Layout

- Home: hero (hook, short line, install, live demo), pillars, three windows, what happens on Enter, in the box, install, questions.
- Docs: a left rail of five topics (quickstart, commands, keys, sessions, login) and a 46rem prose column. On phones the rail becomes a wrapping row.
- Changelog: rendered from the repository's `CHANGELOG.md` at build time.
- Sections are separated by a single rule. No cards inside cards.

## Components

- **Highway player.** A canvas that replays `public/demo/highway.cast` through a small VT interpreter (`app/highway/vt.ts`). The server renders the last frame as styled text, so the page has a real picture with JavaScript off and before the canvas is ready. Box-drawing and block glyphs are drawn as geometry so lanes meet edge to edge. It pauses off-screen, honors reduced motion by showing the final frame, and has a play/pause control.
- **Code block.** Terminal colors, a label bar and a copy button. Prompts (`$ `) are dropped when copying.
- **Pillar grid.** Four cells on a hairline grid, each topped by its lane accent.
- **Flow.** Four numbered steps on a lane rule.

## Do's and don'ts

- Do use real TUI output for any picture of the product. Re-record with `bun run demo`.
- Do keep the terminal dark in light mode.
- Don't add gradients, glows, waveforms, equalizer bars or stock music imagery.
- Don't introduce colors beyond the palette tokens, terminal colors and four lane accents.

## Network footer

`HranessSiteFooter` from `@hraness/site-footer`, without a mailing list.
