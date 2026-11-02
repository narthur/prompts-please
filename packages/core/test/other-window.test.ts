import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { listOtherWindow } from '../src/bureau.ts'

let dir: string
const session = (pid: number, extra: object) =>
  writeFileSync(join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId: `s${pid}`, cwd: '/home/op/work', name: `work-${pid}`, status: 'idle', updatedAt: 1793399574935, ...extra }))
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'sessions-')) })

test('running interactive sessions are listed, headless and dead ones are not', () => {
  session(1, { kind: 'interactive' })
  session(2, { kind: 'headless' })
  session(3, { kind: 'interactive' }) // its process has exited
  writeFileSync(join(dir, '4.json'), 'not json')
  writeFileSync(join(dir, '1.abc.key'), 'secret')

  expect(listOtherWindow(dir, (pid) => pid !== 3)).toMatchObject([
    { sessionId: 's1', cwd: '/home/op/work', name: 'work-1', status: 'idle', updatedAt: '2026-10-30T22:32:54.935Z', character: { label: 'work' } },
  ])
})

test('no sessions folder means an empty other window', () => {
  expect(listOtherWindow(join(dir, 'missing'))).toEqual([])
})
