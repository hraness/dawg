---
id: web-search
title: Web search
parent: project
order: 4
---

The agent can search the web and read public pages, for example to look
up a song's tempo or a chord chart. Fetches never reach private hosts.

## Ask

- "look up the tempo and key of Teardrop by Massive Attack"
- "read this page and copy its chord chart: <url>"

## Where results come from (first match wins)

- `DAWG_WEB_SEARCH=duckduckgo|openrouter|gateway|brave` pins one
- `BRAVE_SEARCH_API_KEY` set: Brave Search
- an AI Gateway key (Exa by default), then an OpenRouter key
- otherwise DuckDuckGo, with no key
