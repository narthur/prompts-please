import { beforeEach, expect, test, vi } from 'vitest'
import type { Decision, Resume } from '../src/bureau.ts'
import { createResumeQueue, createStamper, type RunResume } from '../src/resume-queue.ts'

// A fake Claude runner: records each started resume and lets the test end it.
let started: Resume[]
let exits: Array<() => void>
const fakeRun: RunResume = (resume, onExit) => { started.push(resume); exits.push(onExit) }
beforeEach(() => { started = []; exits = []; vi.spyOn(console, 'error').mockImplementation(() => {}) })

const plain = (sessionId: string): Resume => ({ sessionId, cwd: '/w' })
const withNote = (sessionId: string, prompt: string): Resume => ({ sessionId, cwd: '/w', prompt })

test('a second resume for a running session waits until the first exits', () => {
  const resumeOnce = createResumeQueue(fakeRun)
  resumeOnce(withNote('a', 'one'))
  resumeOnce(withNote('a', 'two'))
  expect(started.map((r) => r.prompt)).toEqual(['one'])

  exits[0]()

  expect(started.map((r) => r.prompt)).toEqual(['one', 'two'])
})

test('queued resumes run in order, one at a time', () => {
  const resumeOnce = createResumeQueue(fakeRun)
  for (const p of ['one', 'two', 'three']) resumeOnce(withNote('a', p))

  exits[0]()
  expect(started).toHaveLength(2)
  exits[1]()

  expect(started.map((r) => r.prompt)).toEqual(['one', 'two', 'three'])
})

test('different sessions do not block each other', () => {
  const resumeOnce = createResumeQueue(fakeRun)
  resumeOnce(plain('a'))
  resumeOnce(plain('b'))

  expect(started.map((r) => r.sessionId)).toEqual(['a', 'b'])
})

test('plain resumes queued behind a running one are collapsed into a single follow-up', () => {
  const resumeOnce = createResumeQueue(fakeRun)
  resumeOnce(plain('a'))
  resumeOnce(plain('a'))
  resumeOnce(plain('a'))

  exits[0]()
  expect(started).toHaveLength(2)
  exits[1]()

  expect(started).toHaveLength(2)
})

test('a resume with a note is still queued behind a parked plain resume', () => {
  const resumeOnce = createResumeQueue(fakeRun)
  resumeOnce(plain('a'))
  resumeOnce(plain('a'))
  resumeOnce(withNote('a', 'note'))

  exits[0](); exits[1]()

  expect(started.map((r) => r.prompt)).toEqual([undefined, undefined, 'note'])
})

test('onExit firing twice (error then exit) frees the session only once', () => {
  const resumeOnce = createResumeQueue(fakeRun)
  resumeOnce(withNote('a', 'one'))
  resumeOnce(withNote('a', 'two'))
  resumeOnce(withNote('a', 'three'))

  exits[0](); exits[0]()

  expect(started.map((r) => r.prompt)).toEqual(['one', 'two'])
})

test('a runner that throws synchronously does not leave the session locked', () => {
  let calls = 0
  const resumeOnce = createResumeQueue((r, onExit) => { if (calls++ === 0) throw new Error('no log'); fakeRun(r, onExit) })
  resumeOnce(withNote('a', 'one'))
  resumeOnce(withNote('a', 'two'))

  expect(started.map((r) => r.prompt)).toEqual(['two'])
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining('resume of a failed to start: no log'))
})

test('a queued resume whose start throws releases the session and the next one still runs', () => {
  let calls = 0
  const resumeOnce = createResumeQueue((r, onExit) => { if (calls++ === 1) throw new Error('boom'); fakeRun(r, onExit) })
  resumeOnce(withNote('a', 'one'))
  resumeOnce(withNote('a', 'two'))
  resumeOnce(withNote('a', 'three'))

  exits[0]()

  expect(started.map((r) => r.prompt)).toEqual(['one', 'three'])
})

const admit: Decision = { verdict: 'admit' }
const now = new Date('2026-11-01T10:00:00Z')

test('the summary is refreshed after the resume is started, without waiting for it to finish', () => {
  const order: string[] = []
  const stampAndResume = createStamper({
    stamp: () => plain('a'),
    run: (r, onExit) => { order.push('resume'); fakeRun(r, onExit) },
    refreshSummary: () => order.push('summary'),
  })

  stampAndResume('t1', admit, now)

  expect(order).toEqual(['resume', 'summary'])
  expect(exits).toHaveLength(1) // the resume is still running
})

test('a stamp behind a running resume still refreshes the summary immediately', () => {
  const refreshSummary = vi.fn()
  const stampAndResume = createStamper({ stamp: () => plain('a'), run: fakeRun, refreshSummary })

  stampAndResume('t1', admit, now)
  stampAndResume('t2', admit, now)

  expect(started).toHaveLength(1)
  expect(refreshSummary).toHaveBeenCalledTimes(2)
})

test('a stamp with nothing to resume only refreshes the summary', () => {
  const refreshSummary = vi.fn()
  createStamper({ stamp: () => null, run: fakeRun, refreshSummary })('t1', admit, now)

  expect(started).toEqual([])
  expect(refreshSummary).toHaveBeenCalledWith(now)
})

test('a failed stamp propagates and neither resumes nor refreshes the summary', () => {
  const refreshSummary = vi.fn()
  const stampAndResume = createStamper({ stamp: () => { throw new Error('unknown') }, run: fakeRun, refreshSummary })

  expect(() => stampAndResume('t1', admit, now)).toThrow('unknown')
  expect(started).toEqual([])
  expect(refreshSummary).not.toHaveBeenCalled()
})

test('a resume that fails to start still gets the summary refreshed and the session freed', () => {
  const refreshSummary = vi.fn()
  let calls = 0
  const stampAndResume = createStamper({
    stamp: () => plain('a'),
    run: (r, onExit) => { if (calls++ === 0) throw new Error('no log'); fakeRun(r, onExit) },
    refreshSummary,
  })

  expect(() => stampAndResume('t1', admit, now)).not.toThrow()
  expect(refreshSummary).toHaveBeenCalledTimes(1)
  stampAndResume('t2', admit, now)
  expect(started).toHaveLength(1)
})
