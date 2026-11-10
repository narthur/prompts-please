// The PreToolUse gate as a function: return the stamped decision for this tool call, or park it in the hall.
// `hook.ts` is the entry shim that wires real stdin, env and exit codes to it.
import { decisionFor, isSafeId, submit, type Decision, type PermissionForm } from './bureau.ts'

export type HookResult = { exitCode: number; stdout?: string; stderr?: string }

export type PreToolUseInputs = {
  /** Reads the raw payload; a throw counts as a malformed payload. */
  readInput: () => string
  stateDir: string
  /** PROMPTS_PLEASE_JOB; the job comes only from here, never from the payload. */
  job: string | undefined
}

// Exit 2 blocks the call; a malformed payload must not slip through unstamped (exit 1 would let it run).
const reject = (why: string): HookResult => ({ exitCode: 2, stderr: `prompts-please hook: ${why}` })

export function preToolUse({ readInput, stateDir, job: rawJob }: PreToolUseInputs): HookResult {
  let input
  try { input = JSON.parse(readInput()) } catch { return reject('payload is not JSON') }
  for (const key of ['session_id', 'cwd', 'tool_name', 'tool_use_id'] as const) {
    if (typeof input?.[key] !== 'string') return reject(`payload missing ${key}`)
  }
  if (!input.tool_input || typeof input.tool_input !== 'object') return reject('payload missing tool_input')
  if (!isSafeId(input.session_id)) return reject('bad session_id')
  const { job: _ignored, ...payload } = input
  const job = rawJob?.trim()
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
  return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...out } }) }
}
