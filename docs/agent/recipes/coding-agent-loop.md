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
dawg check
dawg history --follow
dawg history --actor external --limit 5
```

4. See what the human said about it:

```tool
{"tool":"history_query","args":{"actor":["human"],"kind":["comment"],"limit":5}}
```

The project's AGENTS.md (written by `dawg init`, refreshed by `dawg docs --agent --write`) carries this loop for coding agents that never open dawg.
