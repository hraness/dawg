# Product

<!-- impeccable:product-schema 1 -->

## Platform

Terminal, on the existing macOS and Linux runtime. This is not a web or native GUI
redesign. Preserve the current terminal visual language and tracks renderer.

## Users

People directing an agent to make songs, listen to drafts and request musical
changes. They do not need to learn synthesis parameters or operate a manual DAW.

## Product Purpose

DAWG is an agent-operated song studio with an observable, continuously playable
workspace. The agent composes, arranges, generates vocals, designs sounds, mixes and
masters; the person describes the outcome, listens and steers revisions.

## Operating Context

- A minimal terminal contains playback, chat, an arrangement/tracks overview and a
  horizontally scrolling piano roll for the individual track being written.
- The existing tracks renderer is the overview. Track writing automatically focuses
  the piano roll; a pin keeps inspection on the selected track.
- Playback starts automatically when a coherent draft is ready. A person's later
  pause or stop remains authoritative while generation continues.
- Once playing, accepted changes become audible without losing musical position.
  Pending changes and the audible version are distinguished honestly.
- A user may start with a creative brief, a YouTube URL or a local audio file.

## Capabilities and Constraints

- Initial creative scope is the established house hyperpop style, palette and vocal
  approach. Other genre systems and general generation-parameter interfaces are
  outside the initial scope.
- Reference recreations default to the actual lyrics re-sung by stock British
  `bf_emma`. Preserve the original separated vocal for comparison and explicit
  requests to hear it.
- Original songs and recreations use project-local scores, vocal takes, source
  assets, progress records and exports. Generating a user's song must not modify
  DAWG's source, public demo registry or bundled sample catalog.
- Full manual parameter editors, patch editors, faders and note-entry menus are not
  part of the primary interface. Their underlying engine and agent capabilities
  remain usable.
- Keep local saved-song playback, score editing by agents and deterministic rendering
  usable without a login or mandatory hosted session. New inference and analysis may
  require explicitly configured local tools/models or an agent provider.
- Preserve atomic score/session writes and accepted assets. Resume reuses recorded
  inputs and artifacts; fresh model output is not promised to be byte-identical.
- Source-derived studies, recordings and reconstructed material stay out of the
  distributed original-demo assets.

## Product Principles

1. Make meaningful musical progress visible and audible before a whole job finishes.
2. Show committed musical changes and actual job progress in the listening workspace.
3. Keep written state, asset readiness and audible state distinct. Missing audio
   must not silently masquerade as a finished track.
4. Treat pitch, word clarity, timing, tone and file integrity as separate evidence.
5. Preserve a coherent playable version while a newer one prepares; honor steering,
   cancellation, pause, seek and pinned inspection.

## Evidence on Hand

- Existing immutable scores, project files, session revisions, agent events,
  off-thread audio rendering, progressive monitoring and original demo assets.
- Portable, versioned house-song and reference-recreation workflows, extracted from
  private production work and bundled with the installed product.
- Project-local Kokoro/WORLD stock vocal generation, immutable accepted takes and
  offline replay, with an optional local inference environment.
- Private reference-vocal studies demonstrate close pitch tracking and remaining
  rough consonants/held syllables. Their integrity audits do not prove an exact
  vocal-performance match.

## Delivery Order

After the generation and minimal-player work, make the vocals easier to hear in
all existing demos and private reference-study variants. This vocal-level repair is the
last implementation step, followed only by final checks and delivery.
