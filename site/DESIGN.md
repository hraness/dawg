---
name: dawg studio
description: dawg's variant of the Hraness design system. Flat, high-contrast and grid-first, with the TUI's four track accents filling whole cells like clips in a session view.
colors:
  background: "studio --background: #f7f7f4 light, #0f0f0f dark (Paper palette plus .dawg-studio)"
  surface: "studio --surface: #ffffff light, #181818 dark"
  ink: "studio --foreground: #0f0f0f light, #f2f2ee dark"
  secondary-ink: "palette --muted"
  action: "studio --primary: ink-colored buttons, inverse text"
  terminal-bg: "rgb(24 28 37), the TUI default theme panel, in both modes"
  terminal-fg: "rgb(225 231 239)"
  clip-colors: "#eb6f92, #f6c177, #9ccfd8, #c4a7e7 (track accents, in order), always with #0f0f0f ink"
  rule-strong: "2px solid var(--foreground)"
  rule: "1px, foreground at 22%"
typography:
  display:
    fontFamily: "Nebula Sans (var(--font-text))"
    fontSize: "clamp(2.9rem, 1.2rem + 7.2vw, 7.5rem)"
    fontWeight: 700
    lineHeight: 0.94
    letterSpacing: "-0.045em"
  title:
    fontSize: "clamp(2rem, 1.2rem + 3.2vw, 3.75rem)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.035em"
  wordmark:
    fontFamily: "var(--font-mono)"
    use: "the word dawg in the hero, set on a clip-2 block"
  body:
    fontFamily: "Nebula Sans (var(--font-text))"
    lineHeight: 1.55
  label:
    fontFamily: "var(--font-mono)"
    use: "uppercase eyebrows, step counters, table heads, install labels"
rounded:
  everything: "0"
spacing:
  measure: "80rem"
  gutter: "clamp(1rem, 4vw, 2.5rem)"
  section: "clamp(3rem, 6vw, 4.5rem)"
  section-grid: "4 / 8 columns at 60rem and up"
---

## Overview

dawg.sh uses the shared Hraness packages: `@hraness/design-kit` (palette system, marketing header, pillar grid, install tabs, fonts, not-found page), `@hraness/ui` (copy button), `@hraness/site-footer` (network footer), `@hraness/web-discovery` (share cards) and `@hraness/posthog` (analytics). The page structure follows PeopleBlade's site: the design-kit marketing header, a hero with install, labelled sections, the kit's platform install tabs and the network footer.

**dawg studio** is the site's variant of the design system. It takes its cues from music production software: flat panels, high contrast, a visible grid, bold grotesk headings and color used in solid blocks the way a session view colors its clips. It borrows principles only. No third-party logos, fonts, screenshots or copy.

## How the variant is built

- The document renders with the design kit's Paper palette and the class `dawg-studio` (`app/layout.tsx`, `palette.ts`, `browser/theme-bootstrap.ts`).
- `app/dawg-studio.css` overrides Paper's semantic palette values while both `[data-palette="paper"]` and `.dawg-studio` match, and defines the studio tokens (`--dawg-clip-*`, `--dawg-rule*`, `--dawg-display`, `--dawg-title`, `--dawg-radius`).
- Pick another palette from the appearance menu and the overrides stop matching, so every Hraness palette still works. Layout rules use semantic tokens and keep working under any palette.
- `app/globals.css` holds the site layout and reads only semantic and studio tokens.

## Principles

- **Flat.** No shadows, gradients, glows, blur on content or rounded corners.
- **High contrast.** Near-black ink on near-white paper, and the reverse in dark mode.
- **Grid first.** Full-strength 2px rules separate sections; 1px rules divide cells inside them. Sections put a sticky label column (4 of 12) beside the content (8 of 12) on wide screens.
- **Bold type.** Oversized display headings with tight tracking, in sentence case. Small uppercase mono labels carry structure.
- **Color in blocks.** The four clip colors fill whole cells with black ink on top: the pillar row, the dawg wordmark and the notice bar. They appear nowhere as thin accents or text color.
- **Dense and functional.** Short copy, real product frames and commands, nothing decorative.

## Colors

- Page colors come from palette tokens (`--background`, `--surface`, `--foreground`, `--muted`, `--primary`, `--line`) and the studio tokens.
- Clip colors are the TUI's track accents in order. They do not change between light and dark, and their ink is always `--dawg-clip-ink`.
- Terminal surfaces (highway demo, code blocks, mini windows) keep the fixed terminal colors in both modes because they show real frames.

## Layout

- Home: hero (eyebrow, display heading, lede beside install, live demo), the clip row of four pillars, three windows, what happens on Enter, in the box, install, questions.
- Docs: the install page plus the shared guides from `../guides`, in the same tree as the TUI's guide browser. The tree is a sticky rail on wide screens and a disclosure menu on phones. The current page is an inverse block.
- Changelog: rendered from the repository's `CHANGELOG.md` at build time.

## Components

- **Highway player.** A canvas that replays `public/demo/highway.cast` through a small VT interpreter (`app/highway/vt.ts`). The server renders the last frame as styled text, so the page has a real picture with JavaScript off and before the canvas is ready. It pauses off-screen, honors reduced motion by showing the final frame, and has a play/pause control.
- **Clip row.** The design kit's `MarketingPillars`, each cell filled with a clip color.
- **Feature cells.** `MarketingPillars` again, on rules, four across on wide screens.
- **Install tabs.** The design kit's `PlatformInstall`, flattened, with analytics on copy.
- **Doc mark.** A guide heading or note starts with the TUI's mark (✦ Ask, › Type it yourself, ≡ Menu, ⌃ Keys, → Next, ✓ Tip, ! Careful) in a small chip: clip colour with ink for Ask, Menu, Keys and Careful, inverse ink for Type and Tip, outline otherwise. The symbol carries the meaning; the table lives in `app/doc-marks.ts` and must match `guides/index.ts`.
- **Code block.** Terminal colors, a label bar and a copy button. Prompts (`$ `) are dropped when copying.
- **Flow.** Four numbered cells on a strong rule.
- **Questions.** Disclosure rows on rules.

## Do's and don'ts

- Do use real TUI output for any picture of the product. Re-record with `bun run demo`.
- Do keep the terminal dark in light mode.
- Don't round corners or add shadows, gradients, waveforms, equalizer bars or stock music imagery.
- Don't introduce colors beyond the palette tokens, terminal colors and four clip colors.
- Don't use third-party brand assets, typefaces or wording.

## Network footer

`HranessSiteFooter` from `@hraness/site-footer`, without a mailing list, under a strong rule.
