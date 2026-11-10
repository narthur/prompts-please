// PreToolUse hook entry: Claude Code runs this once per tool call (and again on --resume) with the payload on stdin.
// All behaviour lives in pretooluse.ts; this shim only wires real I/O.
import { readFileSync } from 'node:fs'
import { stateDir } from './config.ts'
import { preToolUse } from './pretooluse.ts'

const { exitCode, stdout, stderr } = preToolUse({ readInput: () => readFileSync(0, 'utf8'), stateDir, job: process.env.PROMPTS_PLEASE_JOB })
if (stderr !== undefined) console.error(stderr)
if (stdout !== undefined) console.log(stdout)
if (exitCode !== 0) process.exit(exitCode)
