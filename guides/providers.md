---
id: providers
title: Providers and models
parent: agent
order: 2
---

The agent needs a provider: a Vercel AI Gateway key, OpenRouter, or a
Codex or Claude subscription. Set one up once and plain sentences go
to the agent.

## Ask

- "which model are you?" (after `model key`)

## Type it yourself

In a shell:

- `dawg model key` finds setups · `dawg model key gateway`

At the prompt:

- `model key` · `model` picker · `model fast` · `logout`
- `/auth --check` · `DAWG_MODEL=<alias>` · `DAWG_AI=0` no agent

## Menu

- Ctrl-K › Project › agent › model · model key

## Keys

- In the model picker ↑↓ move · Enter choose · `/` filter

## Next

- `guide agent` · `guide web-search`
