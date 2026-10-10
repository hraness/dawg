---
id: web-search
title: Web search
parent: agent
order: 3
---

The agent can search the web and read public pages, for example to
look up a song's tempo. Fetches never reach private hosts.

## Ask

- "look up the tempo and key of a song you name"
- "read this page and copy its chord chart: <url>"

## Type it yourself

- `DAWG_WEB_SEARCH=duckduckgo|openrouter|gateway|brave` picks one
- Otherwise dawg tries Brave (with a key), AI Gateway, OpenRouter,
  then DuckDuckGo

## Menu

- Ctrl-K › Project › agent › model

## Keys

- Ctrl-O shows each search and fetch in the transcript

## Next

- `guide agent` · `guide providers`
