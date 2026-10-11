---
id: agent
title: Agent
order: 11
---

The agent is optional: every command works offline without it. With
a provider set, plain sentences go to the agent and it edits the song,
typing each command it runs so you learn them as you go.

```agent
Before editing a part, read the human's comments about it (history_query track:<id> kind:[comment]); #love marks what to keep. After an edit, call comment with what changed and why. Split 2-4 independent parts across subagents with dispatch (recipe/parallel-arrangement). inspect shows the score, a track, notes or the mix in pages without growing the brief. docs {page} reads any tool page or recipe.
```

## Ask

Type what you want in plain words and press Enter.

- "make the reverb wetter and play a C minor arpeggio"

## Type it yourself

- `model key` sets up a provider · `model` picks a model
- `model fast` · `logout` · `/auth --check`
- `showme on` · `showme quiet`

## Menu

- Ctrl-K › Project › agent › model · show-me · model key

## Keys

- Enter sends · Alt-Enter runs next · Esc stops the agent
- Ctrl-Q switches the prompt between NOW and NEXT

## Next

- `guide show-me` · `guide providers` · `guide web-search`
