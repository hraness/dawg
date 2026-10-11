---
id: parallel-arrangement
title: Arrange several parts at once with subagents
tools: [dispatch, history_query, inspect, comment]
---

Goal: write 2-4 independent parts in parallel, each by its own subagent.

1. Split the work by track. Each task names the tracks it may change; `[]` means new tracks only; `bars` narrows note edits; one task at most may be `global` (tempo, form, master).

```tool
{"tool":"dispatch","args":{"tasks":[{"id":"drums","prompt":"a half-time groove for bars 1-8 with a fill into bar 9","tracks":["drums"]},{"id":"bass","prompt":"a bass line that locks to the kick, bars 1-8","tracks":["bass"]},{"id":"pad","prompt":"a new pad track holding the chords","tracks":[]}]}}
```

2. Read what each child did: one line per task comes back, and every child edit is its own revision attributed to its task id.

```tool
{"tool":"history_query","args":{"actor":["subagent"],"kind":["edit"],"limit":10}}
```

3. Resolve conflicts yourself: a task whose edit collided reports `conflict` with the reason; redo that part directly.

```tool
{"tool":"comment","args":{"text":"Arranged drums, bass and a new pad in parallel; bass doubled the kick pattern","about":"turn"}}
```

Pitfalls: do dependent or sequential edits yourself (a bass line that needs the final chords should wait for them). Children cannot dispatch, run trusted exec or change transport.
