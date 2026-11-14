import { afterEach, expect, it, vi } from 'vitest'
import { bureau } from './bureau-client.ts'

const stub = (res: Response | Error) => {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => { if (res instanceof Error) throw res; return res })
  vi.stubGlobal('fetch', fn)
  return fn
}
afterEach(() => vi.unstubAllGlobals())

it('sends the header, content-type and shaped JSON body on a stamp', async () => {
  const fn = stub(new Response('{}'))
  expect(await bureau.stamp('a/b', 'refuse', 'nope')).toEqual({ ok: true, value: undefined })
  expect(fn).toHaveBeenCalledWith('/api/hall/a%2Fb/stamp', {
    method: 'POST',
    headers: { 'X-Prompts-Please': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ verdict: 'refuse', reason: 'nope' }),
  })
  await bureau.stamp('x', 'admit', 'ignored')
  expect(fn.mock.calls[1][1]!.body).toBe('{"verdict":"admit"}')
  await bureau.stamp('x', 'return', 'n')
  expect(fn.mock.calls[2][1]!.body).toBe('{"verdict":"return","note":"n"}')
})

it('sends the header but no body on a revert scan, and none on plain GETs', async () => {
  const fn = stub(Response.json({ incidents: [], errors: [] }))
  await bureau.scanReverts()
  expect(fn).toHaveBeenCalledWith('/api/reverts/scan', { method: 'POST', headers: { 'X-Prompts-Please': '1' }, body: undefined })
  await bureau.hall()
  expect(fn.mock.calls[1]).toEqual(['/api/hall', undefined])
})

it('surfaces a non-OK response as the error text the bureau sent, else status text', async () => {
  stub(Response.json({ error: 'no such visitor' }, { status: 404 }))
  expect(await bureau.complain('x', 'why')).toEqual({ ok: false, error: 'no such visitor', kind: 'http' })
  stub(new Response('<html>', { status: 502, statusText: 'Bad Gateway' }))
  expect(await bureau.hall()).toEqual({ ok: false, error: '502 Bad Gateway', kind: 'http' })
})

it('maps a thrown fetch to unreachable and a non-JSON OK body to unreadable', async () => {
  stub(new TypeError('failed'))
  expect(await bureau.hall()).toEqual({ ok: false, error: 'bureau unreachable', kind: 'unreachable' })
  stub(new Response('<html>'))
  expect(await bureau.hall()).toEqual({ ok: false, error: 'bureau unreachable', kind: 'unreadable' })
})
