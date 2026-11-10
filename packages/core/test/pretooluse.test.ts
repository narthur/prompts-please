import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { listHall, stamp } from '../src/bureau.ts'
import { preToolUse } from '../src/pretooluse.ts'

const raw = readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8')
const call = JSON.parse(raw)
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pretooluse-')) })

const gate = (payload: unknown, job?: string) =>
  preToolUse({ readInput: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)), stateDir: dir, job })
const decision = (r: ReturnType<typeof gate>) => JSON.parse(r.stdout!).hookSpecificOutput

test('a payload that is not JSON is blocked with exit 2', () => {
  expect(gate('not json')).toEqual({ exitCode: 2, stderr: 'prompts-please hook: payload is not JSON' })
})

test('a stdin that cannot be read is blocked like a malformed payload', () => {
  const r = preToolUse({ readInput: () => { throw new Error('EAGAIN') }, stateDir: dir, job: undefined })
  expect(r).toEqual({ exitCode: 2, stderr: 'prompts-please hook: payload is not JSON' })
})

test.each(['null', '"text"', '42'])('JSON that is not an object (%s) is blocked for the first missing key', (text) => {
  expect(gate(text)).toEqual({ exitCode: 2, stderr: 'prompts-please hook: payload missing session_id' })
})

test.each(['session_id', 'cwd', 'tool_name', 'tool_use_id'])('a payload missing %s is blocked', (key) => {
  expect(gate({ ...call, [key]: undefined })).toEqual({ exitCode: 2, stderr: `prompts-please hook: payload missing ${key}` })
  expect(gate({ ...call, [key]: 7 }).exitCode).toBe(2)
})

test.each([undefined, null, 'x'])('tool_input %j is blocked', (toolInput) => {
  expect(gate({ ...call, tool_input: toolInput })).toEqual({ exitCode: 2, stderr: 'prompts-please hook: payload missing tool_input' })
})

test('an array tool_input is accepted, as it always was (typeof [] is object)', () => {
  expect(decision(gate({ ...call, tool_input: [] }))).toMatchObject({ permissionDecision: 'defer' })
})

test.each(['../etc', 'a/b', 'a b', ''])('an unsafe session_id %j is blocked', (id) => {
  expect(gate({ ...call, session_id: id })).toEqual({ exitCode: 2, stderr: 'prompts-please hook: bad session_id' })
})

test('an unsafe tool_use_id is denied (exit 0) rather than allowed', () => {
  const r = gate({ ...call, tool_use_id: '../escape' })
  expect(r.exitCode).toBe(0)
  expect(decision(r)).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' })
  expect(decision(r).permissionDecisionReason).toContain('invalid tool use id')
})

test('an unstamped call is parked in the hall and deferred', () => {
  const r = gate(call)
  expect(r).toEqual({ exitCode: 0, stdout: expect.any(String) })
  expect(decision(r)).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'defer', permissionDecisionReason: 'Parked in the hall for the operator.' })
  expect(listHall(dir)).toMatchObject([{ toolUseId: call.tool_use_id, sessionId: call.session_id, cwd: call.cwd, toolName: call.tool_name, toolInput: call.tool_input }])
})

test('the job comes from the env value, never from the payload', () => {
  gate({ ...call, job: 'from-payload' }, '  real-job ')
  expect(listHall(dir)[0]).toMatchObject({ job: 'real-job' })
  const other = { ...call, tool_use_id: 'toolu_other' }
  gate({ ...other, job: 'from-payload' }, '   ')
  expect(listHall(dir).find((v) => v.toolUseId === 'toolu_other')!.job).toBeUndefined()
})

test('stamped verdicts become allow / deny decisions', () => {
  gate(call)
  stamp(dir, call.tool_use_id, { verdict: 'admit' })
  expect(decision(gate(call))).toMatchObject({ permissionDecision: 'allow', permissionDecisionReason: 'Admitted by the operator.' })

  const refused = { ...call, tool_use_id: 'toolu_refused' }
  gate(refused)
  stamp(dir, 'toolu_refused', { verdict: 'refuse', reason: 'no' })
  expect(decision(gate(refused))).toMatchObject({ permissionDecision: 'deny', permissionDecisionReason: 'The operator refused this tool call: no' })

  const returned = { ...call, tool_use_id: 'toolu_returned' }
  gate(returned)
  stamp(dir, 'toolu_returned', { verdict: 'return', note: 'use Edit' })
  expect(decision(gate(returned))).toMatchObject({
    permissionDecision: 'deny',
    permissionDecisionReason: 'The operator returned this tool call with a note. Adjust and try again: use Edit',
  })
})

test('a corrupt stamp denies, never lets the call through', () => {
  mkdirSync(join(dir, 'decisions'), { recursive: true })
  writeFileSync(join(dir, 'decisions', `${call.tool_use_id}.json`), '{ nope')
  const r = gate(call)
  expect(r.exitCode).toBe(0)
  expect(decision(r)).toMatchObject({ permissionDecision: 'deny' })
  expect(decision(r).permissionDecisionReason).toContain(`could not read the operator's decision (invalid decision for ${call.tool_use_id})`)
})

test('a failure while parking the call denies', () => {
  writeFileSync(join(dir, 'hall'), 'a file where the hall folder should be')
  expect(decision(gate(call))).toMatchObject({ permissionDecision: 'deny' })
})
