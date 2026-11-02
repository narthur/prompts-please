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

State lives in `~/.local/state/prompts-please` (override with `PROMPTS_PLEASE_STATE`; port with `PROMPTS_PLEASE_PORT`). Every stamp is appended to `ledger.jsonl` there.

To get a daily ledger note (for example in Obsidian), set `PROMPTS_PLEASE_SUMMARY_DIR` to a folder; the bureau rewrites `<date>.md` there after each stamp.

Each visitor is a recurring character, one per project directory. To tell several agents in one project apart, launch each with `PROMPTS_PLEASE_JOB=<label>` (for example `PROMPTS_PLEASE_JOB=nightly claude -p ...`). Trust shown at the booth is display-only.

## Develop

```sh
pnpm test       # core tests (Vitest)
pnpm typecheck
```

Sprites in `assets/derived/` are built from `assets/originals/` by `./derive.sh`. Never write to `assets/originals/`.
