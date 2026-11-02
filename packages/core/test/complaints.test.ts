process.env.TZ = 'UTC'

import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { submit, stamp, listHall, readLedger, fileComplaint, dailySummary, decisionFor } from '../src/bureau.ts'

const writeCall = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))
const call = (id: string) => ({ ...writeCall, tool_use_id: id })

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'complaints-'))
  submit(dir, call('toolu_a'))
  stamp(dir, 'toolu_a', { verdict: 'admit' }, new Date('2026-11-01T09:00:00Z'))
})

test('filing a complaint against a stamp sends an incident visitor to the hall', () => {
  fileComplaint(dir, 'toolu_a', 'It overwrote my notes.', new Date('2026-11-01T11:00:00Z'))

  const [incident] = listHall(dir, new Date('2026-11-01T11:00:10Z'))
  expect(incident).toMatchObject({
    kind: 'incident',
    against: 'toolu_a',
    complaint: 'It overwrote my notes.',
    toolName: 'Write',
    toolInput: writeCall.tool_input,
    waitSeconds: 10,
  })
})

test('the complaint is recorded in the ledger', () => {
  fileComplaint(dir, 'toolu_a', 'It overwrote my notes.', new Date('2026-11-01T11:00:00Z'))

  expect(readLedger(dir).at(-1)).toMatchObject({
    type: 'complaint', at: '2026-11-01T11:00:00.000Z', against: 'toolu_a', reason: 'It overwrote my notes.',
  })
})

test('a stamp can only be complained about once', () => {
  fileComplaint(dir, 'toolu_a', 'First.')

  expect(() => fileComplaint(dir, 'toolu_a', 'Again.')).toThrow(/already/)
  expect(listHall(dir)).toHaveLength(1)
})

test('complaints need a reason and an existing stamp', () => {
  expect(() => fileComplaint(dir, 'toolu_a', ' ')).toThrow(/reason/)
  expect(() => fileComplaint(dir, 'toolu_unknown', 'Bad.')).toThrow(/no stamp/)
})

test('stamping an incident closes it without creating a decision for any tool call', () => {
  const incident = fileComplaint(dir, 'toolu_a', 'It overwrote my notes.')

  const resumable = stamp(dir, incident, { verdict: 'refuse', reason: 'Expected behaviour.' })

  expect(resumable).toBeNull()
  expect(listHall(dir)).toEqual([])
  expect(decisionFor(dir, incident)).toBeNull()
  expect(readLedger(dir).at(-1)).toMatchObject({ type: 'stamp', toolUseId: incident, against: 'toolu_a', decision: { verdict: 'refuse' } })
})

test('incidents themselves cannot be complained about', () => {
  const incident = fileComplaint(dir, 'toolu_a', 'Bad.')
  stamp(dir, incident, { verdict: 'admit' })

  expect(() => fileComplaint(dir, incident, 'Meta.')).toThrow(/incident/)
})

test('complaints appear in the daily summary', () => {
  fileComplaint(dir, 'toolu_a', 'It overwrote my notes.', new Date('2026-11-01T11:00:00Z'))

  expect(dailySummary(readLedger(dir), '2026-11-01')).toContain('- 11:00 **Complaint** against Write in `work`: It overwrote my notes.')
})

test('the summary shows a stamped incident as upheld or dismissed', () => {
  const incident = fileComplaint(dir, 'toolu_a', 'Bad.', new Date('2026-11-01T11:00:00Z'))
  stamp(dir, incident, { verdict: 'refuse', reason: 'Fine as is.' }, new Date('2026-11-01T11:05:00Z'))

  expect(dailySummary(readLedger(dir), '2026-11-01')).toContain('- 11:05 **Dismiss** complaint about Write in `work`: Fine as is.')
})

test('an incident can be upheld or dismissed, not returned', () => {
  const incident = fileComplaint(dir, 'toolu_a', 'Bad.')

  expect(() => stamp(dir, incident, { verdict: 'return', note: 'Hmm.' })).toThrow(/upheld or dismissed/)
  expect(listHall(dir)).toHaveLength(1)
})

test('only admissions can be complained about', () => {
  submit(dir, call('toolu_r'))
  stamp(dir, 'toolu_r', { verdict: 'refuse', reason: 'No.' })

  expect(() => fileComplaint(dir, 'toolu_r', 'Should have allowed it.')).toThrow(/admission/)
})

test('the summary header counts admitted calls separately from upheld and dismissed complaints', () => {
  const incident = fileComplaint(dir, 'toolu_a', 'Bad.', new Date('2026-11-01T11:00:00Z'))
  stamp(dir, incident, { verdict: 'admit' }, new Date('2026-11-01T11:05:00Z'))

  expect(dailySummary(readLedger(dir), '2026-11-01')).toContain(
    '1 stamp: 1 admitted, 0 refused, 0 returned. 1 complaint filed: 1 upheld, 0 dismissed.',
  )
})

test('ledger lines missing the papers fields are skipped', () => {
  appendFileSync(join(dir, 'ledger.jsonl'), '{"type":"complaint","at":"2026-11-01T12:00:00Z","toolUseId":"inc_x","against":"toolu_a","reason":"r"}\n')

  expect(readLedger(dir).map((e) => e.type)).toEqual(['stamp'])
})
