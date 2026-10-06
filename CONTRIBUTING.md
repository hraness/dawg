# Contributing

Track is developed as a small, local-first terminal application. Keep changes focused and preserve the user-visible command contract in `README.md` and `TRACK.md`.

Before opening a pull request:

```sh
bun install --frozen-lockfile
bun run check
```

Changes to score parsing, session persistence, agent operations, or terminal input need focused regression tests. Keep filesystem and provider boundaries bounded and parse foreign values from `unknown`. Do not add login, hosted session state, or a required network dependency to the local workflow.

The project uses the default `main` branch. Pull requests should explain the user-visible behavior, the commands used for validation, and any terminal or operating-system limits.
