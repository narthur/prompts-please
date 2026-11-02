import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { fileFinished, listHall, matchReverts, readLedger, stamp } from '../src/bureau.ts'

const run = { session_id: 'sess-1', cwd: '/home/op/work', message: 'Done.', commits: ['aaa111', 'bbb222'] }
// A fake git: the reverts each repo's log contains.
const gitWith = (reverts: Record<string, { sha: string; reverted: string[] }[]>) => ({ reverts: (cwd: string) => reverts[cwd] ?? [] })

let dir: string
let admitted: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'reverts-'))
  admitted = fileFinished(dir, run)!
  stamp(dir, admitted, { verdict: 'admit' })
})

test('an admission records the commits it covered', () => {
  expect(readLedger(dir)).toMatchObject([{ toolUseId: admitted, covers: ['aaa111', 'bbb222'] }])
})

test('a revert of a covered commit raises one complaint against the admission', () => {
  const { incidents: raised } = matchReverts(dir, gitWith({ '/home/op/work': [{ sha: 'ccc333', reverted: ['bbb222'] }] }))

  expect(raised).toHaveLength(1)
  expect(listHall(dir)).toMatchObject([{ kind: 'incident', against: admitted, complaint: 'Commit bbb222 was reverted by ccc333.' }])
})

test('unrelated reverts raise nothing', () => {
  expect(matchReverts(dir, gitWith({ '/home/op/work': [{ sha: 'ccc333', reverted: ['zzz999'] }], '/other': [{ sha: 'd', reverted: ['aaa111'] }] })).incidents).toEqual([])
  expect(listHall(dir)).toEqual([])
})

test('re-scanning, or reverting a second covered commit, does not duplicate the complaint', () => {
  const git = gitWith({ '/home/op/work': [{ sha: 'ccc333', reverted: ['bbb222'] }, { sha: 'ddd444', reverted: ['aaa111'] }] })

  matchReverts(dir, git)
  expect(matchReverts(dir, git).incidents).toEqual([])
  expect(readLedger(dir).filter((e) => e.type === 'complaint')).toHaveLength(1)
})

test('refused work is not complained about when reverted', () => {
  const refused = fileFinished(dir, { ...run, commits: ['eee555'] }, new Date(Date.now() + 1))!
  stamp(dir, refused, { verdict: 'refuse', reason: 'No.' })

  expect(matchReverts(dir, gitWith({ '/home/op/work': [{ sha: 'f', reverted: ['eee555'] }] })).incidents).toEqual([])
})

test('a revert naming the commit by an abbreviated sha still matches', () => {
  expect(matchReverts(dir, gitWith({ '/home/op/work': [{ sha: 'ccc333', reverted: ['bbb2'] }] })).incidents).toHaveLength(1)
})
