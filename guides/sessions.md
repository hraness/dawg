---
id: sessions
title: Sessions and windows
parent: project
order: 2
---

A session is one song's shared record: its score, undo history and
name. Open `dawg` in more than one terminal on the same folder and each
window can focus a different track while edits sync to all of them.

```agent
Every edit, undo, comment and agent turn lands in .dawg/history.db; history_query reads it (filters: track, instrument, param, bars, kind, actor, tag, grep, since; show for one row). Undo reaches back through this store. Comments carry the human's pane, focus, playhead and loop: use them as pointers to what they mean by "this part". Recipe: recipe/read-history-before-editing.
```

## Ask

- "name this session night drive"

## Type it yourself

- `sessions` · `/resume` picker · `/resume 2` or a name
- `/rename night drive` · `/rename --auto` · `/fork` · `status`

In a shell:

- `dawg --new` · `dawg --session <name>` · `dawg --track bass`

## Menu

- Ctrl-K › Project › session › rename · fork · resume

## Keys

- In the picker ↑↓ move · Enter resumes · `/` filter · Esc back

## Next

- `guide panes` · `guide files` · `guide agent`
