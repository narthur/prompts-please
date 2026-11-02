import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { submit, stamp, listHall, fileComplaint } from '../src/bureau.ts'

const writeCall = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))
const call = (id: string, extra: Record<string, unknown> = {}) => ({ ...writeCall, tool_use_id: id, ...extra })

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'characters-')) })

const admitMany = (prefix: string, n: number, extra: Record<string, unknown> = {}) => {
  for (let i = 0; i < n; i++) { submit(dir, call(`${prefix}${i}`, extra)); stamp(dir, `${prefix}${i}`, { verdict: 'admit' }) }
}

test('visitors from the same project and job are the same character', () => {
  submit(dir, call('toolu_a'))
  submit(dir, call('toolu_b'))
  submit(dir, call('toolu_c', { job: 'nightly' }))

  const [a, b, c] = listHall(dir).sort((x, y) => x.toolUseId.localeCompare(y.toolUseId))
  expect(a.character).toEqual(b.character)
  expect(c.character.id).not.toBe(a.character.id)
  expect(a.character).toMatchObject({ label: 'work' })
  expect(c.character).toMatchObject({ label: 'work/nightly' })
  expect(a.character.name).toMatch(/^WOR-\d\d$/)
  expect(a.character.portrait).toBeGreaterThanOrEqual(1)
  expect(a.character.portrait).toBeLessThanOrEqual(12)
})

test('a new character has no record yet', () => {
  submit(dir, call('toolu_new'))

  expect(listHall(dir)[0].trust).toEqual({ admitted: 0, complaints: 0, level: 'unknown' })
})

test('trust grows with clean admissions', () => {
  admitMany('toolu_ok', 10)
  submit(dir, call('toolu_next'))

  expect(listHall(dir)[0].trust).toEqual({ admitted: 10, complaints: 0, level: 'trusted' })
})

test('complaints count against trust unless dismissed, and cancel the admission they are about', () => {
  admitMany('toolu_ok', 4)
  const upheld = fileComplaint(dir, 'toolu_ok0', 'Broke the build.')
  stamp(dir, upheld, { verdict: 'admit' })
  const dismissed = fileComplaint(dir, 'toolu_ok1', 'Meh.')
  stamp(dir, dismissed, { verdict: 'refuse', reason: 'Not its fault.' })
  submit(dir, call('toolu_next'))

  expect(listHall(dir).find((v) => v.toolUseId === 'toolu_next')?.trust).toEqual({ admitted: 3, complaints: 1, level: 'suspect' }) // the disowned admission no longer counts
})

test('another character’s record does not affect this one', () => {
  admitMany('toolu_ok', 10, { job: 'nightly' })
  submit(dir, call('toolu_next'))

  expect(listHall(dir)[0].trust.admitted).toBe(0)
})
