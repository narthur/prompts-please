// PreToolUse hook: return the stamped decision for this tool call, or park it in the hall.
// Claude Code runs this once per tool call (and again on --resume) with the payload on stdin.
import { readFileSync } from 'node:fs'
import { decisionFor, submit, type Decision, type PermissionForm } from './bureau.ts'
import { stateDir } from './config.ts'

// Exit 2 blocks the call; a malformed payload must not slip through unstamped (exit 1 would let it run).
function reject(why: string): never {
  console.error(`prompts-please hook: ${why}`)
  process.exit(2)
}
let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { reject('payload is not JSON') }
for (const key of ['session_id', 'cwd', 'tool_name', 'tool_use_id'] as const) {
  if (typeof input?.[key] !== 'string') reject(`payload missing ${key}`)
}
if (!input.tool_input || typeof input.tool_input !== 'object') reject('payload missing tool_input')
if (!/^[A-Za-z0-9_-]+$/.test(input.session_id)) reject('bad session_id')
// job comes only from our env var, never from the payload.
const { job: _ignored, ...payload } = input
const job = process.env.PROMPTS_PLEASE_JOB?.trim()
const form: PermissionForm = job ? { ...payload, job } : payload

function respond(decision: Decision | null) {
  if (!decision) {
    submit(stateDir, form)
    return { permissionDecision: 'defer', permissionDecisionReason: 'Parked in the hall for the operator.' }
  }
  switch (decision.verdict) {
    case 'admit': return { permissionDecision: 'allow', permissionDecisionReason: 'Admitted by the operator.' }
    case 'refuse': return { permissionDecision: 'deny', permissionDecisionReason: `The operator refused this tool call: ${decision.reason}` }
    case 'return': return { permissionDecision: 'deny', permissionDecisionReason: `The operator returned this tool call with a note. Adjust and try again: ${decision.note}` }
  }
}
let out
try {
  out = respond(decisionFor(stateDir, form.tool_use_id))
} catch (e) {
  // A corrupt stamp must never let the call through.
  out = { permissionDecision: 'deny', permissionDecisionReason: `The bureau could not read the operator's decision (${(e as Error).message}).` }
}

console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }))
