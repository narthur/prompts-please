// SessionStart and Stop hook entry. All behaviour lives in session-bookkeeping.ts; this shim only wires real I/O.
import { readFileSync } from 'node:fs'
import { stateDir } from './config.ts'
import { commitsSince, head } from './services/git/index.ts'
import { sessionHook } from './session-bookkeeping.ts'

const { stderr } = sessionHook({ stdin: readFileSync(0, 'utf8'), stateDir, job: process.env.PROMPTS_PLEASE_JOB, git: { head, commitsSince } })
if (stderr !== undefined) { console.error(stderr); process.exit(0) }
