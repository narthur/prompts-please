import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { decisionFor, listHall, readLedger, stamp, submit } from '../src/bureau.ts'

const writeCall = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'robust-')) })

test('stamping the same tool call twice records one decision and one ledger line', () => {
  submit(dir, writeCall)
  stamp(dir, writeCall.tool_use_id, { verdict: 'admit' })

  expect(() => stamp(dir, writeCall.tool_use_id, { verdict: 'refuse', reason: 'Changed my mind.' })).toThrow(/not in the hall/)
  expect(decisionFor(dir, writeCall.tool_use_id)).toEqual({ verdict: 'admit' })
  expect(readLedger(dir)).toHaveLength(1)
})

test('a visitor whose session transcript is gone is marked stale, not dropped', () => {
  const transcript = join(dir, 'session.jsonl')
  writeFileSync(transcript, '')
  submit(dir, { ...writeCall, tool_use_id: 'toolu_live', transcript_path: transcript }, new Date('2026-11-01T10:00:00Z'))
  submit(dir, { ...writeCall, tool_use_id: 'toolu_gone', transcript_path: join(dir, 'deleted.jsonl') }, new Date('2026-11-01T10:00:01Z'))

  expect(listHall(dir).map((v) => [v.toolUseId, v.stale])).toEqual([['toolu_live', false], ['toolu_gone', true]])
  expect(stamp(dir, 'toolu_gone', { verdict: 'admit' })).toBeNull() // nothing to resume
  expect(readLedger(dir)).toHaveLength(1) // but the stamp is recorded
})
