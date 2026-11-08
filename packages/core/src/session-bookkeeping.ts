// SessionStart and Stop hooks as a function: remember where a run started, and file it as finished work when it stops.
// `session-hook.ts` is the entry shim that wires real stdin, env and git to it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileFinished, isSafeId } from './bureau.ts'

/** The git seam: the real adapter is services/git, tests use a fake. */
export type Git = {
  head: (cwd: string) => string | null
  commitsSince: (cwd: string, base: string | null) => string[]
}

export type SessionHookInputs = {
  /** Raw payload; unparseable JSON throws, as the hook always has (exit 1, never blocks). */
  stdin: string
  stateDir: string
  /** PROMPTS_PLEASE_JOB. */
  job: string | undefined
  git: Git
}

// ponytail: one small file per session, never cleaned up; prune old ones if the folder ever matters.
type Base = { cwd: string; sha: string | null }

/** Returns a message for stderr when the payload is unusable; always exit 0, never block the agent over bookkeeping. */
export function sessionHook({ stdin, stateDir, job: rawJob, git }: SessionHookInputs): { stderr?: string } {
  const input = JSON.parse(stdin)
  const { session_id: sessionId, cwd } = input ?? {}
  if (typeof sessionId !== 'string' || !isSafeId(sessionId) || typeof cwd !== 'string') {
    return { stderr: 'prompts-please session hook: bad session_id or cwd' }
  }
  const basesDir = join(stateDir, 'bases')
  const baseFile = join(basesDir, sessionId)
  // The repo is the one the run started in, even if the agent later changed directory.
  const readBase = (): Base | null => { try { return JSON.parse(readFileSync(baseFile, 'utf8')) } catch { return null } }
  const writeBase = (b: Base) => { mkdirSync(basesDir, { recursive: true }); writeFileSync(baseFile, JSON.stringify(b)) }

  if (input.hook_event_name === 'SessionStart') {
    // A resume keeps the base from where the run started or was last reviewed.
    if (!readBase()) writeBase({ cwd, sha: git.head(cwd) })
  } else if (input.hook_event_name === 'Stop') {
    // ponytail: interrogation forks (#9) must launch without this hook, or every answer files finished work.
    const base = readBase() ?? { cwd, sha: null }
    const job = rawJob?.trim()
    const message = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : ''
    const filed = fileFinished(stateDir, { session_id: sessionId, cwd: base.cwd, message, commits: git.commitsSince(base.cwd, base.sha), ...(job ? { job } : {}) })
    // Only a filed run moves the base; a run parked on a tool call keeps its commits for the finished visitor.
    if (filed) writeBase({ cwd: base.cwd, sha: git.head(base.cwd) })
  }
  return {}
}
