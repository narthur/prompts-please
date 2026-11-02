// Local HTTP API over the bureau. Every client (the web booth, a future Godot one) talks only to this.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { dailySummary, listHall, parseDecision, readLedger, stamp } from './bureau.ts'
import { matcher, port, stateDir, summaryDir } from './config.ts'
import { resumeSession } from './services/claude/index.ts'
import { writeDailySummary } from './services/vault/index.ts'

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Settings an agent is launched with (`claude -p --settings <this file>`); resumes reuse them.
const settingsPath = join(stateDir, 'agent-settings.json')
const hookPath = fileURLToPath(new URL('./hook.ts', import.meta.url))
mkdirSync(stateDir, { recursive: true })
writeFileSync(settingsPath, JSON.stringify({
  hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command: `PROMPTS_PLEASE_STATE=${shellQuote(stateDir)} node ${shellQuote(hookPath)}` }] }] },
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

createServer((req, res) => {
  if (!trusted(req)) return send(res, 403, { error: 'forbidden' })
  const url = new URL(req.url ?? '/', 'http://localhost')

  if (req.method === 'GET' && url.pathname === '/api/hall') return send(res, 200, listHall(stateDir))
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
      let form
      const now = new Date() // one clock reading, so the stamp lands in the note for its own day
      try { form = stamp(stateDir, decodeURIComponent(stampRoute[1]), decision, now) } catch (e) {
        const message = (e as Error).message
        return send(res, /not in the hall/.test(message) ? 404 : 400, { error: message })
      }
      resumeSession({ sessionId: form.session_id, cwd: form.cwd, settingsPath, stateDir })
      if (summaryDir) {
        const today = now.toLocaleDateString('sv-SE')
        // ponytail: re-reads the whole ledger per stamp; read only the tail if the ledger gets large.
        try { writeDailySummary(summaryDir, today, dailySummary(readLedger(stateDir), today)) } catch (e) { console.error(`daily summary failed: ${(e as Error).message}`) }
      }
      send(res, 200, { stamped: form.tool_use_id, verdict: decision.verdict })
    }, () => send(res, 413, { error: 'body too large' }))
    return
  }

  send(res, 404, { error: 'not found' })
}).listen(port, '127.0.0.1', () => {
  console.log(`Bureau open on http://127.0.0.1:${port}  (state: ${stateDir})`)
  console.log(`Launch agents with: claude -p "<task>" --settings ${settingsPath}`)
})
