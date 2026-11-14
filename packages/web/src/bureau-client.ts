// The booth's one door to the bureau API: owns the paths, the X-Prompts-Please header, body shapes and error text.
// Types are core's own (type-only imports, erased at build). Fetch is looked up per call so tests can stub it.
import type { Verdict } from './scene.ts'
import type { Visitor, LedgerEntry, Notice, InteractiveSession, Directive } from '../../core/src/bureau.ts'

export type { Visitor, LedgerEntry, Notice, InteractiveSession, Directive }
// 'http': the bureau answered not-OK; 'unreachable': fetch threw; 'unreadable': OK, but the body was not JSON.
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; kind: 'http' | 'unreachable' | 'unreadable' }

async function errorText(res: Response): Promise<string> {
  try { return (await res.json()).error ?? res.statusText } catch { return `${res.status} ${res.statusText}` }
}

const id = encodeURIComponent
// ponytail: `parse: false` for calls whose OK body nobody reads, so an empty body can't turn success into an error.
async function call<T>(path: string, post?: unknown, parse = true): Promise<Result<T>> {
  let res: Response
  try {
    res = await fetch(path, post === undefined ? undefined : {
      method: 'POST',
      headers: post === null ? { 'X-Prompts-Please': '1' } : { 'X-Prompts-Please': '1', 'content-type': 'application/json' },
      body: post === null ? undefined : JSON.stringify(post),
    })
  } catch {
    return { ok: false, error: 'bureau unreachable', kind: 'unreachable' }
  }
  try {
    if (!res.ok) return { ok: false, error: await errorText(res), kind: 'http' }
    return { ok: true, value: parse ? await res.json() : (undefined as T) }
  } catch {
    return { ok: false, error: 'bureau unreachable', kind: 'unreadable' }
  }
}

export const bureau = {
  hall: () => call<Visitor[]>('/api/hall'),
  ledger: () => call<LedgerEntry[]>('/api/ledger?limit=50'),
  otherWindow: () => call<InteractiveSession[]>('/api/other-window'),
  directives: (toolUseId: string) => call<Directive[]>(`/api/hall/${id(toolUseId)}/directives`),
  interrogate: (toolUseId: string, question: string) => call<{ answer: string }>(`/api/hall/${id(toolUseId)}/interrogate`, { question }),
  stamp: (toolUseId: string, verdict: Verdict, text: string) =>
    call<void>(`/api/hall/${id(toolUseId)}/stamp`, verdict === 'admit' ? { verdict } : verdict === 'refuse' ? { verdict, reason: text } : { verdict, note: text }, false),
  complain: (toolUseId: string, reason: string) => call<void>(`/api/ledger/${id(toolUseId)}/complaint`, { reason }, false),
  scanReverts: () => call<{ incidents: string[]; errors: string[] }>('/api/reverts/scan', null),
  listNotices: () => call<Notice[]>('/api/notices'),
  postNotice: (task: unknown, cwd: unknown) => call<void>('/api/notices', { task, cwd }, false),
}
