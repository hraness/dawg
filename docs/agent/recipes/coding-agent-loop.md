---
id: coding-agent-loop
title: Edit a dawg project from a coding agent in another terminal
tools: [read_file, edit_file, grep, history_query]
---

Goal: a coding agent (or you, through the file tools) edits the project files while the human plays the song in dawg.

1. The project is plain TypeScript: `song.ts` and `tracks/<slug>/track.ts`. Find what to change:

```tool
{"tool":"grep","args":{"pattern":"instrument:","glob":"*.ts"}}
```

```tool
{"tool":"read_file","args":{"path":"tracks/bass/track.ts"}}
```

2. Make one exact edit; the open dawg window reloads it as a new revision.

```tool
{"tool":"edit_file","args":{"path":"tracks/bass/track.ts","old":"volume: 0.8","new":"volume: 0.7"}}
```

3. From a shell, check and watch:

```dawg
dawg check --as codex --files tracks/bass/track.ts
dawg history --follow
dawg history --actor external --limit 5
```

`--as` (or `DAWG_ACTOR`) credits the reload to you instead of `external`; `--files` names the files you changed.

4. When the human runs `dawg dev`, dawg also writes `log` rows (file sync evaluations, typecheck results as file:line, rejected evaluations, tool arguments, errors), and each pane writes its current frame as text:

```dawg
dawg history --follow --kind log
dawg dev screen A
```

```tool
{"tool":"history_query","args":{"kind":["log"],"limit":10}}
```

`dawg dev --reload` is for working on dawg's own source from a checkout: it restarts the editor after each change that imports cleanly.

5. See what the human said about it:

```tool
{"tool":"history_query","args":{"actor":["human"],"kind":["comment"],"limit":5}}
```

The project's AGENTS.md (written by `dawg init`, refreshed by `dawg docs --agent --write`) carries this loop for coding agents that never open dawg.
