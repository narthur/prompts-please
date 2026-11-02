// Local HTTP API over the bureau. Every client (the web booth, a future Godot one) talks only to this.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dailySummary, directives, fileComplaint, interrogate, listHall, listOtherWindow, matchReverts, NotFound, parseDecision, readLedger, stamp } from './bureau.ts'
import { globalDirectives, matcher, port, sessionsDir, stateDir, summaryDir } from './config.ts'
import * as claude from './services/claude/index.ts'
import { writeDailySummary } from './services/vault/index.ts'
import * as git from './services/git/index.ts'

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Settings an agent is launched with (`claude -p --settings <this file>`); resumes reuse them.
const settingsPath = join(stateDir, 'agent-settings.json')
const hookCommand = (file: string) =>
  `PROMPTS_PLEASE_STATE=${shellQuote(stateDir)} node ${shellQuote(fileURLToPath(new URL(file, import.meta.url)))}`
mkdirSync(stateDir, { recursive: true })
writeFileSync(settingsPath, JSON.stringify({
  hooks: {
    PreToolUse: [{ matcher, hooks: [{ type: 'command', command: hookCommand('./hook.ts') }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: hookCommand('./session-hook.ts') }] }],
    Stop: [{ hooks: [{ type: 'command', command: hookCommand('./session-hook.ts') }] }],
  },
}, null, 2))

// Rejects once the body passes the limit, but keeps draining it so the 413 can still be sent.
function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    let tooLarge = false
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { if (!tooLarge) body += chunk; if (Buffer.byteLength(body) > limit) tooLarge = true })
    req.on('end', () => (tooLarge ? reject(new Error('too large')) : resolve(body)))
    req.on('error', reject)
  })
}

const parseJson = (raw: string): unknown => { try { return JSON.parse(raw) } catch { return null } }

const send = (res: ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

// Stamping runs code on this machine, so refuse anything a web page elsewhere could trigger:
// a foreign Host (DNS rebinding) or a POST without the custom header (cross-site form posts can't set it).
function trusted(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (host !== 'localhost' && host !== '127.0.0.1') return false
  return req.method !== 'POST' || req.headers['x-prompts-please'] === '1'
}

const sendError = (res: ServerResponse, e: unknown) =>
  send(res, e instanceof NotFound ? 404 : e instanceof claude.Upstream ? 502 : 400, { error: (e as Error).message })

// A malformed escape is left as is; the bureau's id check then rejects it with a 400 instead of throwing here.
const decodeId = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

// One interrogation per visitor at a time: each one is a full claude run.
const asking = new Set<string>()

// ponytail: runs on start and when the booth asks; schedule it if reverts should surface unprompted.
function scanReverts(): { incidents: string[]; errors: string[] } {
  const now = new Date()
  let result: { incidents: string[]; errors: string[] }
  try { result = matchReverts(stateDir, git, now) } catch (e) { result = { incidents: [], errors: [(e as Error).message] } }
  for (const e of result.errors) console.error(`revert scan: ${e}`)
  if (result.incidents.length) refreshSummary(now)
  return result
}

function refreshSummary(now: Date) {
  if (!summaryDir) return
  const today = now.toLocaleDateString('sv-SE')
  // ponytail: re-reads the whole ledger per write; read only the tail if the ledger gets large.
  try { writeDailySummary(summaryDir, today, dailySummary(readLedger(stateDir), today)) } catch (e) { console.error(`daily summary failed: ${(e as Error).message}`) }
}

createServer((req, res) => {
  if (!trusted(req)) return send(res, 403, { error: 'forbidden' })
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/api/hall') return send(res, 200, listHall(stateDir))
  if (req.method === 'GET' && url.pathname === '/api/other-window') return send(res, 200, listOtherWindow(sessionsDir))
  if (req.method === 'GET' && url.pathname === '/api/ledger') {
    // The booth shows recent entries only; leave out toolInput (can be whole files).
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500)
    return send(res, 200, readLedger(stateDir).slice(-limit).map(({ toolInput, ...rest }) => rest))
  }

  const stampRoute = url.pathname.match(/^\/api\/hall\/([^/]+)\/stamp$/)
  if (req.method === 'POST' && stampRoute) {
    readBody(req).then((raw) => {
      const decision = parseDecision(parseJson(raw))
      if (!decision) return send(res, 400, { error: 'body must be {"verdict":"admit"} | {"verdict":"refuse","reason":…} | {"verdict":"return","note":…}' })
      const id = decodeId(stampRoute[1])
      const now = new Date() // one clock reading, so the stamp lands in the note for its own day
      let resume
      try { resume = stamp(stateDir, id, decision, now) } catch (e) { return sendError(res, e) }
      if (resume) claude.resumeSession({ ...resume, settingsPath, stateDir })
      refreshSummary(now)
      send(res, 200, { stamped: id, verdict: decision.verdict })
    }, () => send(res, 413, { error: 'body too large' }))
    return
  }

  const complaintRoute = url.pathname.match(/^\/api\/ledger\/([^/]+)\/complaint$/)
  if (req.method === 'POST' && complaintRoute) {
    readBody(req).then((raw) => {
      const reason = (parseJson(raw) as { reason?: unknown } | null)?.reason
      if (typeof reason !== 'string') return send(res, 400, { error: 'body must be {"reason": string}' })
      const now = new Date()
      let incident
      try { incident = fileComplaint(stateDir, decodeId(complaintRoute[1]), reason, now) } catch (e) { return sendError(res, e) }
      refreshSummary(now)
      send(res, 200, { incident })
    }, () => send(res, 413, { error: 'body too large' }))
    return
  }

  const boardRoute = url.pathname.match(/^\/api\/hall\/([^/]+)\/directives$/)
  if (req.method === 'GET' && boardRoute) {
    try { return send(res, 200, directives(stateDir, decodeId(boardRoute[1]), globalDirectives)) } catch (e) { return sendError(res, e) }
  }

  const askRoute = url.pathname.match(/^\/api\/hall\/([^/]+)\/interrogate$/)
  if (req.method === 'POST' && askRoute) {
    readBody(req).then((raw) => {
      const question = (parseJson(raw) as { question?: unknown } | null)?.question
      if (typeof question !== 'string') return send(res, 400, { error: 'body must be {"question": string}' })
      const id = decodeId(askRoute[1])
      if (asking.has(id)) return send(res, 409, { error: 'already interrogating this visitor' })
      asking.add(id)
      interrogate(stateDir, id, question, claude)
        .then((answer) => send(res, 200, { answer }), (e) => sendError(res, e))
        .finally(() => asking.delete(id))
    }, () => send(res, 413, { error: 'body too large' }))
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/reverts/scan') return send(res, 200, scanReverts())

  send(res, 404, { error: 'not found' })
}).listen(port, '127.0.0.1', () => {
  const { incidents } = scanReverts()
  if (incidents.length) console.log(`Reverts found: ${incidents.length} complaint(s) filed`)
  console.log(`Bureau open on http://127.0.0.1:${port}  (state: ${stateDir})`)
  console.log(`Launch agents with: claude -p "<task>" --settings ${settingsPath}`)
})
