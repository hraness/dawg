# Contents

- `core/` – immutable score and loop encoding.
- `src/` – local session, agent gateway, audio, and CLI runtime.
- `tui/` – terminal rendering and prompt editing.
- `DAWG.md` – detailed interaction contract.

# Guidelines

- Keep the local, no-login workflow complete and usable without network access.
- Keep score, event, prompt, and gateway inputs bounded and validate foreign values from `unknown`.
- Preserve atomic multi-window session writes and deterministic audio rendering.
- Add focused tests for parser, reducer, persistence, terminal, and rendering changes.
