---
id: providers
title: Providers and models
parent: project
order: 3
---
Commands work offline. Plain requests go to the agent once a provider
is set: AI Gateway, OpenRouter, or a Codex or Claude subscription.

## Shell
- `dawg login` finds existing setups and lets you pick
- `dawg login gateway` · `openrouter` · `codex` · `claude`
- `dawg model` pick a model with the cost per prompt
- `dawg auth status --check` · `dawg logout`

## In the app
- `/login` · `/model` picker · `/model <alias>` · `/logout`
- `/auth --check` provider and audio status

## Environment
- `DAWG_PROVIDER=gateway` · `DAWG_MODEL=<alias>` · `DAWG_AI=0` no agent
