import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { listHall, submit } from '../src/bureau.ts'
import { sessionHook, type Git } from '../src/session-bookkeeping.ts'

let dir: string
let heads: Record<string, string | null>
let commits: string[]
let git: Git
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'session-hook-'))
  heads = { '/repo': 'sha-start' }
  commits = ['c1', 'c2']
  git = { head: (cwd) => heads[cwd] ?? null, commitsSince: () => commits }
})

const run = (payload: unknown, job?: string) =>
  sessionHook({ stdin: typeof payload === 'string' ? payload : JSON.stringify(payload), stateDir: dir, job, git })
const base = (id = 's1') => JSON.parse(readFileSync(join(dir, 'bases', id), 'utf8'))

test('SessionStart records the repo and its head', () => {
  expect(run({ session_id: 's1', cwd: '/repo', hook_event_name: 'SessionStart' })).toEqual({})
  expect(base()).toEqual({ cwd: '/repo', sha: 'sha-start' })
})

test('SessionStart outside a repo records a null sha', () => {
  run({ session_id: 's1', cwd: '/nowhere', hook_event_name: 'SessionStart' })
  expect(base()).toEqual({ cwd: '/nowhere', sha: null })
})

test('a resumed SessionStart keeps the original base', () => {
  run({ session_id: 's1', cwd: '/repo', hook_event_name: 'SessionStart' })
  heads['/other'] = 'sha-other'
  run({ session_id: 's1', cwd: '/other', hook_event_name: 'SessionStart' })
  expect(base()).toEqual({ cwd: '/repo', sha: 'sha-start' })
})

test('Stop files finished work with the commits since the base and moves the base', () => {
  run({ session_id: 's1', cwd: '/repo', hook_event_name: 'SessionStart' })
  heads['/repo'] = 'sha-end'
  const seen: unknown[] = []
  git.commitsSince = (cwd, b) => { seen.push([cwd, b]); return commits }
  run({ session_id: 's1', cwd: '/elsewhere', hook_event_name: 'Stop', last_assistant_message: 'Done.' }, ' job-1 ')

  expect(seen).toEqual([['/repo', 'sha-start']])
  expect(listHall(dir)).toMatchObject([{ kind: 'finished', sessionId: 's1', cwd: '/repo', job: 'job-1', toolInput: { message: 'Done.', commits: ['c1', 'c2'] } }])
  expect(base()).toEqual({ cwd: '/repo', sha: 'sha-end' })
})

test('Stop without a recorded base uses the payload cwd and no commits base', () => {
  const seen: unknown[] = []
  git.commitsSince = (cwd, b) => { seen.push([cwd, b]); return [] }
  run({ session_id: 's1', cwd: '/repo', hook_event_name: 'Stop' })
  expect(seen).toEqual([['/repo', null]])
  expect(listHall(dir)).toMatchObject([{ kind: 'finished', toolInput: { message: '', commits: [] } }])
  expect(listHall(dir)[0].job).toBeUndefined()
})

test('a non-string last_assistant_message files an empty message', () => {
  run({ session_id: 's1', cwd: '/repo', hook_event_name: 'Stop', last_assistant_message: 5 })
  expect(listHall(dir)[0]).toMatchObject({ toolInput: { message: '' } })
})

test('a run parked on a tool call is not filed and keeps its base', () => {
  run({ session_id: 's1', cwd: '/repo', hook_event_name: 'SessionStart' })
  const call = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))
  submit(dir, { ...call, session_id: 's1' })
  heads['/repo'] = 'sha-end'
  run({ session_id: 's1', cwd: '/repo', hook_event_name: 'Stop' })
  expect(listHall(dir).map((v) => v.kind)).not.toContain('finished')
  expect(base()).toEqual({ cwd: '/repo', sha: 'sha-start' })
})

test('other events do nothing', () => {
  expect(run({ session_id: 's1', cwd: '/repo', hook_event_name: 'UserPromptSubmit' })).toEqual({})
  expect(readdirSync(dir)).toEqual([])
})

test.each([
  ['unsafe session id', { session_id: '../x', cwd: '/repo', hook_event_name: 'Stop' }],
  ['missing session id', { cwd: '/repo', hook_event_name: 'Stop' }],
  ['missing cwd', { session_id: 's1', hook_event_name: 'Stop' }],
  ['null payload', null],
])('%s is reported and writes nothing', (_n, payload) => {
  expect(run(payload)).toEqual({ stderr: 'prompts-please session hook: bad session_id or cwd' })
  expect(readdirSync(dir)).toEqual([])
})

test('unparseable stdin throws, as the hook always has', () => {
  expect(() => run('not json')).toThrow()
})
