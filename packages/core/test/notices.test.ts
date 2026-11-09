import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { listNotices, postNotice } from '../src/bureau.ts'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'notices-')) })

test('a posted notice is listed, newest first, and survives a reread', () => {
  postNotice(dir, { task: 'Fix the typo in README', cwd: dir }, new Date('2026-11-09T20:00:00Z'))
  postNotice(dir, { task: '  Add a test  ', cwd: dir }, new Date('2026-11-09T21:00:00Z'))

  expect(listNotices(dir)).toMatchObject([
    { task: 'Add a test', cwd: dir, postedAt: '2026-11-09T21:00:00.000Z' },
    { task: 'Fix the typo in README', cwd: dir, postedAt: '2026-11-09T20:00:00.000Z' },
  ])
})

test('a notice needs a job and a site that is an existing absolute folder', () => {
  expect(() => postNotice(dir, { task: '  ', cwd: dir })).toThrow('a notice needs a job')
  expect(() => postNotice(dir, { task: 'x', cwd: 'relative/path' })).toThrow('the site must be an existing folder')
  expect(() => postNotice(dir, { task: 'x', cwd: join(dir, 'missing') })).toThrow('the site must be an existing folder')
  expect(listNotices(dir)).toEqual([])
})
