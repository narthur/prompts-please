import { homedir } from 'node:os'
import { join } from 'node:path'

/** Shared by the hook and the server; the hook gets it through the env var baked into the agent settings. */
export const stateDir = process.env.PROMPTS_PLEASE_STATE ?? join(homedir(), '.local', 'state', 'prompts-please')
export const port = Number(process.env.PROMPTS_PLEASE_PORT ?? 4317)
// ponytail: fixed matcher; make it configurable when an agent needs a different set of tools parked.
export const matcher = 'Bash|Write|Edit|NotebookEdit'
/** Folder for daily ledger notes (e.g. inside an Obsidian vault). Unset: no notes are written. */
export const summaryDir = process.env.PROMPTS_PLEASE_SUMMARY_DIR
/** Claude Code's registry of running sessions, for the other window. */
export const sessionsDir = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'sessions')
