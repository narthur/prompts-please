// Local HTTP API over the bureau. Every client (the web booth, a future Godot one) talks only to this.
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { admit, listHall } from './bureau.ts'
import { matcher, port, stateDir } from './config.ts'
import { resumeSession } from './services/claude/index.ts'

const shellQuote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

// Settings an agent is launched with (`claude -p --settings <this file>`); resumes reuse them.
const settingsPath = join(stateDir, 'agent-settings.json')
const hookPath = fileURLToPath(new URL('./hook.ts', import.meta.url))
mkdirSync(stateDir, { recursive: true })
writeFileSync(settingsPath, JSON.stringify({
  hooks: { PreToolUse: [{ matcher, hooks: [{ type: 'command', command: `PROMPTS_PLEASE_STATE=${shellQuote(stateDir)} node ${shellQuote(hookPath)}` }] }] },
}, null, 2))

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

  const stamp = url.pathname.match(/^\/api\/hall\/([^/]+)\/admit$/)
  if (req.method === 'POST' && stamp) {
    let form
    try { form = admit(stateDir, decodeURIComponent(stamp[1])) } catch (e) { return send(res, 404, { error: (e as Error).message }) }
    resumeSession({ sessionId: form.session_id, cwd: form.cwd, settingsPath, stateDir })
    return send(res, 200, { admitted: form.tool_use_id })
  }

  send(res, 404, { error: 'not found' })
}).listen(port, '127.0.0.1', () => {
  console.log(`Bureau open on http://127.0.0.1:${port}  (state: ${stateDir})`)
  console.log(`Launch agents with: claude -p "<task>" --settings ${settingsPath}`)
})
