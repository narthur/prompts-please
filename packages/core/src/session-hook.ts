// SessionStart and Stop hooks: remember where a run started, and file it as finished work when it stops.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileFinished } from './bureau.ts'
import { stateDir } from './config.ts'
import { commitsSince, head } from './services/git/index.ts'

const input = JSON.parse(readFileSync(0, 'utf8'))
const { session_id: sessionId, cwd } = input ?? {}
if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(sessionId) || typeof cwd !== 'string') {
  console.error('prompts-please session hook: bad session_id or cwd')
  process.exit(0) // never block the agent over bookkeeping
}
const basesDir = join(stateDir, 'bases')
const baseFile = join(basesDir, sessionId)
// The repo is the one the run started in, even if the agent later changed directory.
// ponytail: one small file per session, never cleaned up; prune old ones if the folder ever matters.
type Base = { cwd: string; sha: string | null }
const readBase = (): Base | null => { try { return JSON.parse(readFileSync(baseFile, 'utf8')) } catch { return null } }
const writeBase = (b: Base) => { mkdirSync(basesDir, { recursive: true }); writeFileSync(baseFile, JSON.stringify(b)) }

if (input.hook_event_name === 'SessionStart') {
  // A resume keeps the base from where the run started or was last reviewed.
  if (!readBase()) writeBase({ cwd, sha: head(cwd) })
} else if (input.hook_event_name === 'Stop') {
  // ponytail: interrogation forks (#9) must launch without this hook, or every answer files finished work.
  const base = readBase() ?? { cwd, sha: null }
  const job = process.env.PROMPTS_PLEASE_JOB?.trim()
  const message = typeof input.last_assistant_message === 'string' ? input.last_assistant_message : ''
  const filed = fileFinished(stateDir, { session_id: sessionId, cwd: base.cwd, message, commits: commitsSince(base.cwd, base.sha), ...(job ? { job } : {}) })
  // Only a filed run moves the base; a run parked on a tool call keeps its commits for the finished visitor.
  if (filed) writeBase({ cwd: base.cwd, sha: head(base.cwd) })
}
