# Prompts Please

A customs booth for headless Claude Code agents. A blocked tool call parks in the hall, the operator stamps it at the booth, and the agent resumes.

## Run

```sh
pnpm install
pnpm dev
```

This starts the bureau (core HTTP API on `127.0.0.1:4317`) and the booth (Vite, URL printed in the output). The bureau prints the `--settings` file to launch agents with:

```sh
claude -p "<task>" --settings ~/.local/state/prompts-please/agent-settings.json
```

Run the bureau from a normal shell, not inside the Claude Code sandbox: resumed sessions need to write to `~/.claude/projects` and reach `api.anthropic.com`.

State lives in `~/.local/state/prompts-please` (override with `PROMPTS_PLEASE_STATE`; port with `PROMPTS_PLEASE_PORT`).

## Develop

```sh
pnpm test       # core tests (Vitest)
pnpm typecheck
```

Sprites in `assets/derived/` are built from `assets/originals/` by `./derive.sh`. Never write to `assets/originals/`.
