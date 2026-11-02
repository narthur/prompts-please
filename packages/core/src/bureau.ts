// The bureau: the hall of waiting visitors and the decisions stamped on them.
// State lives in a directory so the hook (a separate process per tool call) and the server share it.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A PreToolUse hook payload, as Claude Code sends it on stdin. */
export type PermissionForm = {
  session_id: string
  transcript_path?: string
  cwd: string
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
}

export type Visitor = {
  toolUseId: string
  sessionId: string
  cwd: string
  toolName: string
  toolInput: Record<string, unknown>
  arrivedAt: string
  waitSeconds: number
}

type HallEntry = { form: PermissionForm; arrivedAt: string }

export type Decision =
  | { verdict: 'admit' }
  | { verdict: 'refuse'; reason: string }
  | { verdict: 'return'; note: string }

const hallDir = (dir: string) => join(dir, 'hall')
const decisionsDir = (dir: string) => join(dir, 'decisions')

// Ids become file names, so only allow the characters Claude Code uses (toolu_...).
function fileFor(folder: string, toolUseId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(toolUseId)) throw new Error(`invalid tool use id: ${JSON.stringify(toolUseId)}`)
  return join(folder, `${toolUseId}.json`)
}

// Write-then-rename so the server never reads a half-written file from the hook process.
function writeAtomic(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 1))
  renameSync(tmp, file)
}

function readEntry(file: string): HallEntry | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

export function submit(dir: string, form: PermissionForm, now = new Date()): void {
  mkdirSync(hallDir(dir), { recursive: true })
  const file = fileFor(hallDir(dir), form.tool_use_id)
  // The hook re-files a still-parked call on every resume; keep its original arrival.
  const arrivedAt = readEntry(file)?.arrivedAt ?? now.toISOString()
  writeAtomic(file, { form, arrivedAt } satisfies HallEntry)
}

export function listHall(dir: string, now = new Date()): Visitor[] {
  let files: string[]
  try { files = readdirSync(hallDir(dir)) } catch { return [] }
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => readEntry(join(hallDir(dir), f)))
    .filter((e): e is HallEntry => e !== null)
    .map(({ form, arrivedAt }) => ({
      toolUseId: form.tool_use_id,
      sessionId: form.session_id,
      cwd: form.cwd,
      toolName: form.tool_name,
      toolInput: form.tool_input,
      arrivedAt,
      waitSeconds: Math.floor((now.getTime() - Date.parse(arrivedAt)) / 1000),
    }))
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt))
}

/** Stamp a waiting visitor. Returns its form so the caller can resume the session. */
export function stamp(dir: string, toolUseId: string, decision: Decision): PermissionForm {
  const hallFile = fileFor(hallDir(dir), toolUseId)
  // The agent acts on this text, so a refusal or return must say something.
  if (decision.verdict === 'refuse' && !decision.reason.trim()) throw new Error('a refusal needs a reason')
  if (decision.verdict === 'return' && !decision.note.trim()) throw new Error('a return needs a note')
  const entry = readEntry(hallFile)
  if (!entry) throw new Error(`${toolUseId} is not in the hall`)
  mkdirSync(decisionsDir(dir), { recursive: true })
  writeAtomic(fileFor(decisionsDir(dir), toolUseId), decision)
  rmSync(hallFile)
  return entry.form
}

/** Validate untrusted data (an HTTP body, a decision file) as a Decision; null if it isn't one. */
export function parseDecision(raw: unknown): Decision | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (r.verdict === 'admit') return { verdict: 'admit' }
  if (r.verdict === 'refuse' && typeof r.reason === 'string') return { verdict: 'refuse', reason: r.reason }
  if (r.verdict === 'return' && typeof r.note === 'string') return { verdict: 'return', note: r.note }
  return null
}

/** The stamp on a tool call, or null if none yet. Throws if the decision file is corrupt. */
export function decisionFor(dir: string, toolUseId: string): Decision | null {
  const file = fileFor(decisionsDir(dir), toolUseId)
  let text: string
  try { text = readFileSync(file, 'utf8') } catch { return null }
  let decision: Decision | null = null
  try { decision = parseDecision(JSON.parse(text)) } catch {}
  if (!decision) throw new Error(`invalid decision for ${toolUseId}`)
  return decision
}
