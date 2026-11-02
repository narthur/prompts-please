// PreToolUse hook: return the stamped decision for this tool call, or park it in the hall.
// Claude Code runs this once per tool call (and again on --resume) with the payload on stdin.
import { readFileSync } from 'node:fs'
import { decisionFor, submit, type PermissionForm } from './bureau.ts'
import { stateDir } from './config.ts'

const input = JSON.parse(readFileSync(0, 'utf8'))
for (const key of ['session_id', 'cwd', 'tool_name', 'tool_use_id'] as const) {
  if (typeof input?.[key] !== 'string') {
    // Exit 2 blocks the call; a malformed payload must not slip through unstamped.
    console.error(`prompts-please hook: payload missing ${key}`)
    process.exit(2)
  }
}
const form = input as PermissionForm

const decision = decisionFor(stateDir, form.tool_use_id)
const out = decision
  ? { permissionDecision: 'allow', permissionDecisionReason: 'Admitted by the operator.' }
  : (submit(stateDir, form), { permissionDecision: 'defer', permissionDecisionReason: 'Parked in the hall for the operator.' })

console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }))
