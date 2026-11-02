import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { interrogate, listHall, readLedger, submit } from '../src/bureau.ts'

const writeCall = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))

// A fake claude service that remembers what it was asked.
const asked: unknown[] = []
const claude = { forkAndAsk: async (q: { sessionId: string; cwd: string; question: string }) => { asked.push(q); return 'Because the README was missing.' } }

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'interrogate-')); asked.length = 0; submit(dir, writeCall) })

test('interrogating a visitor asks its session the question and returns the answer', async () => {
  const answer = await interrogate(dir, writeCall.tool_use_id, 'Why this file?', claude)

  expect(answer).toBe('Because the README was missing.')
  expect(asked).toEqual([{ sessionId: writeCall.session_id, cwd: writeCall.cwd, question: 'Why this file?' }])
})

test('interrogation leaves the visitor waiting and records nothing', async () => {
  await interrogate(dir, writeCall.tool_use_id, 'Why?', claude)

  expect(listHall(dir)).toHaveLength(1)
  expect(readLedger(dir)).toEqual([])
})

test('an empty question or an unknown visitor is rejected without asking', async () => {
  await expect(interrogate(dir, writeCall.tool_use_id, '  ', claude)).rejects.toThrow(/question/)
  await expect(interrogate(dir, 'toolu_nobody', 'Why?', claude)).rejects.toThrow(/not in the hall/)
  expect(asked).toEqual([])
})
