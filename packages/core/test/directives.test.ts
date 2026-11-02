import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import { directives, submit } from '../src/bureau.ts'

const writeCall = JSON.parse(readFileSync(new URL('./pretooluse-write.json', import.meta.url), 'utf8'))

let dir: string, root: string, global: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'directives-'))
  root = mkdtempSync(join(tmpdir(), 'repo-'))
  global = join(root, 'global-CLAUDE.md')
  writeFileSync(global, 'Be kind.')
  mkdirSync(join(root, 'repo', 'pkg'), { recursive: true })
})

test('the board shows the global rules and every CLAUDE.md from the project up', () => {
  writeFileSync(join(root, 'repo', 'CLAUDE.md'), 'Use pnpm.')
  writeFileSync(join(root, 'repo', 'pkg', 'CLAUDE.md'), 'No classes.')
  submit(dir, { ...writeCall, cwd: join(root, 'repo', 'pkg') })

  expect(directives(dir, writeCall.tool_use_id, global)).toEqual([
    { source: global, text: 'Be kind.' },
    { source: join(root, 'repo', 'CLAUDE.md'), text: 'Use pnpm.' },
    { source: join(root, 'repo', 'pkg', 'CLAUDE.md'), text: 'No classes.' },
  ])
})

test('a project without a CLAUDE.md shows the global rules only', () => {
  submit(dir, { ...writeCall, cwd: join(root, 'repo', 'pkg') })

  expect(directives(dir, writeCall.tool_use_id, global)).toEqual([{ source: global, text: 'Be kind.' }])
})

test('an unknown visitor has no board', () => {
  expect(() => directives(dir, 'toolu_nobody', global)).toThrow(/not in the hall/)
})
