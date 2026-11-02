import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { submit, listHall, admit, decisionFor } from '../src/bureau.ts'

// A real PreToolUse payload captured during the spike.
const writeCall = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bureau-')) })

test('a submitted form appears in the hall as a visitor', () => {
  submit(dir, writeCall, new Date('2026-11-01T10:00:00Z'))

  const hall = listHall(dir, new Date('2026-11-01T10:00:30Z'))

  expect(hall).toHaveLength(1)
  expect(hall[0]).toMatchObject({
    toolUseId: 'toolu_01MDQCbC7memBX28KVjwa442',
    sessionId: '6d22fe94-edc1-49a9-8d33-808ad8456087',
    toolName: 'Write',
    toolInput: { content: 'hello from the booth' },
    waitSeconds: 30,
  })
})

test('the hall lists visitors oldest first', () => {
  submit(dir, { ...writeCall, tool_use_id: 'toolu_aaa_late' }, new Date('2026-11-01T10:05:00Z'))
  submit(dir, { ...writeCall, tool_use_id: 'toolu_zzz_early' }, new Date('2026-11-01T10:00:00Z'))

  const hall = listHall(dir, new Date('2026-11-01T10:10:00Z'))

  expect(hall.map((v) => [v.toolUseId, v.waitSeconds])).toEqual([['toolu_zzz_early', 600], ['toolu_aaa_late', 300]])
})

test('a tool call nobody has stamped has no decision', () => {
  submit(dir, writeCall)

  expect(decisionFor(dir, writeCall.tool_use_id)).toBeNull()
  expect(decisionFor(dir, 'toolu_never_seen')).toBeNull()
})

test('admitting a visitor allows its tool call and clears it from the hall', () => {
  submit(dir, writeCall)

  admit(dir, writeCall.tool_use_id)

  expect(decisionFor(dir, writeCall.tool_use_id)).toEqual({ verdict: 'admit' })
  expect(listHall(dir)).toEqual([])
})

test('tool use ids that could escape the state directory are rejected', () => {
  expect(() => submit(dir, { ...writeCall, tool_use_id: '../../etc/x' })).toThrow(/tool use id/)
  expect(() => admit(dir, '../hall/x')).toThrow(/tool use id/)
  expect(() => decisionFor(dir, '../x')).toThrow(/tool use id/)
})

test('admitting a visitor who is not in the hall fails', () => {
  expect(() => admit(dir, 'toolu_not_here')).toThrow(/not in the hall/)
})

test('a call that is filed again while still parked keeps its place in the queue', () => {
  submit(dir, writeCall, new Date('2026-11-01T10:00:00Z'))
  submit(dir, writeCall, new Date('2026-11-01T10:05:00Z'))

  expect(listHall(dir, new Date('2026-11-01T10:10:00Z'))[0].waitSeconds).toBe(600)
})

test('an unreadable hall file is skipped instead of breaking the hall', () => {
  submit(dir, writeCall)
  mkdirSync(join(dir, 'hall'), { recursive: true })
  writeFileSync(join(dir, 'hall', 'toolu_half_written.json'), '{"form": {"ses')

  expect(listHall(dir).map((v) => v.toolUseId)).toEqual([writeCall.tool_use_id])
})
