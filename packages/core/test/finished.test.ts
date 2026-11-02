import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { fileFinished, listHall, readLedger, stamp, submit } from '../src/bureau.ts'

const writeCall = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))
const run = { session_id: 'sess-1', cwd: '/home/op/work', message: 'Added the README.', commits: ['abc1234', 'def5678'] }

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'finished-')) })

test('a finished run waits in the hall with its final message and commits', () => {
  const id = fileFinished(dir, run, new Date('2026-11-01T10:00:00Z'))

  expect(listHall(dir, new Date('2026-11-01T10:00:05Z'))).toMatchObject([{
    kind: 'finished',
    toolUseId: id,
    sessionId: 'sess-1',
    cwd: '/home/op/work',
    toolName: 'Finished work',
    toolInput: { message: 'Added the README.', commits: ['abc1234', 'def5678'] },
    waitSeconds: 5,
  }])
})

test('admitting finished work closes it, records it, and resumes nothing', () => {
  const id = fileFinished(dir, run)!

  expect(stamp(dir, id, { verdict: 'admit' })).toBeNull()
  expect(listHall(dir)).toEqual([])
  expect(readLedger(dir)).toMatchObject([{ type: 'stamp', toolUseId: id, toolName: 'Finished work', decision: { verdict: 'admit' } }])
})

test('refusing finished work closes it and records the refusal', () => {
  const id = fileFinished(dir, run)!

  expect(stamp(dir, id, { verdict: 'refuse', reason: 'Wrong repo.' })).toBeNull()
  expect(readLedger(dir)).toMatchObject([{ decision: { verdict: 'refuse', reason: 'Wrong repo.' } }])
})

test('returning finished work resumes the session with the note as the prompt', () => {
  const id = fileFinished(dir, run)!

  expect(stamp(dir, id, { verdict: 'return', note: 'Add a licence too.' }))
    .toEqual({ sessionId: 'sess-1', cwd: '/home/op/work', prompt: 'Add a licence too.' })
})

test('a stamped tool call resumes its session with no prompt', () => {
  submit(dir, writeCall)

  expect(stamp(dir, writeCall.tool_use_id, { verdict: 'admit' })).toEqual({ sessionId: writeCall.session_id, cwd: writeCall.cwd })
})

test('a run that stopped on a parked tool call is not filed as finished', () => {
  submit(dir, writeCall)

  expect(fileFinished(dir, { ...run, session_id: writeCall.session_id })).toBeNull()
  expect(listHall(dir).map((v) => v.kind)).toEqual(['permission'])
})

test("another session's parked tool call doesn't stop this run being filed", () => {
  submit(dir, writeCall)

  expect(fileFinished(dir, { ...run, session_id: 'some-other-session' })).toMatch(/^fin_/)
})
