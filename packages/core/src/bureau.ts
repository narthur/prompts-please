// The bureau: the hall of waiting visitors and the decisions stamped on them.
// State lives in a directory so the hook (a separate process per tool call) and the server share it.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/** A PreToolUse hook payload, as Claude Code sends it on stdin. */
export type PermissionForm = {
  session_id: string
  transcript_path?: string
  cwd: string
  tool_name: string
  tool_input: Record<string, unknown>
  tool_use_id: string
  /** Our addition: the job label from PROMPTS_PLEASE_JOB, set by the hook. */
  job?: string
}

/** A finished headless run, filed by the Stop hook. */
export type FinishedForm = { session_id: string; cwd: string; message: string; commits: string[]; job?: string }

/** What the caller should resume after a stamp: the session, with a prompt when finished work is returned. */
export type Resume = { sessionId: string; cwd: string; prompt?: string; job?: string }

/** A recurring robot: one per project directory plus job label. */
export type Character = { id: string; label: string; name: string; portrait: number }
export type Trust = { admitted: number; complaints: number; level: 'unknown' | 'known' | 'trusted' | 'suspect' }

export type Visitor = Papers & { toolUseId: string; arrivedAt: string; waitSeconds: number; character: Character; trust: Trust } & (
  | { kind: 'permission' }
  /** A complaint about an earlier admission (`against`). */
  | { kind: 'incident'; against: string; complaint: string }
  /** A finished run; toolInput holds { message, commits }. */
  | { kind: 'finished' }
)

/** Thrown when the visitor or stamp asked for doesn't exist (HTTP 404). */
export class NotFound extends Error {}

/** What the visitor is carrying: the tool call it wants, or the one a complaint is about. */
type Papers = { sessionId: string; cwd: string; toolName: string; toolInput: Record<string, unknown>; job?: string }

type HallEntry =
  | { kind?: 'permission'; form: PermissionForm; arrivedAt: string }
  | { kind: 'incident'; id: string; against: string; complaint: string; papers: Papers; arrivedAt: string }
  | { kind: 'finished'; id: string; papers: Papers; arrivedAt: string }

const papersOf = (f: PermissionForm): Papers =>
  ({ sessionId: f.session_id, cwd: f.cwd, toolName: f.tool_name, toolInput: f.tool_input, ...(f.job ? { job: f.job } : {}) })

// FNV-1a: a stable small hash so every client draws the same robot for a character.
function hash(text: string): number {
  let h = 0x811c9dc5
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0
  return h
}

// Structured, so no cwd/job pair can collide with another; cheap, so trust can compare it per ledger line.
const characterId = (p: { cwd: string; job?: string }) => JSON.stringify([p.cwd, p.job ?? null])

export function characterOf(p: { cwd: string; job?: string }): Character {
  const id = characterId(p)
  const project = basename(p.cwd) || p.cwd
  const prefix = (project.replace(/[^A-Za-z0-9]/g, '').toUpperCase() + 'XXX').slice(0, 3)
  const h = hash(id)
  return { id, label: p.job ? `${project}/${p.job}` : project, name: `${prefix}-${(h % 90) + 10}`, portrait: (h % 12) + 1 }
}

/** Display-only: nothing is admitted because of trust. A complaint counts unless dismissed, and its admission stops counting. */
// ponytail: scans the whole ledger per visitor on every hall poll; index by character once if the ledger gets large.
export function trustOf(ledger: LedgerEntry[], id: string): Trust {
  const mine = ledger.filter((e) => characterId(e) === id)
  const dismissed = new Set(mine.flatMap((e) => (e.type === 'stamp' && e.against && e.decision.verdict === 'refuse' ? [e.against] : [])))
  const complainedAbout = new Set(mine.flatMap((e) => (e.type === 'complaint' && !dismissed.has(e.against) ? [e.against] : [])))
  const admitted = mine.filter((e) => e.type === 'stamp' && !e.against && e.decision.verdict === 'admit' && !complainedAbout.has(e.toolUseId)).length
  const complaints = complainedAbout.size
  const level = complaints > 0 && admitted < complaints * 10 ? 'suspect'
    : admitted >= 10 && complaints === 0 ? 'trusted'
    : admitted < 3 ? 'unknown'
    : 'known'
  return { admitted, complaints, level }
}

export type Decision =
  | { verdict: 'admit' }
  | { verdict: 'refuse'; reason: string }
  | { verdict: 'return'; note: string }

const hallDir = (dir: string) => join(dir, 'hall')
const decisionsDir = (dir: string) => join(dir, 'decisions')
const ledgerFile = (dir: string) => join(dir, 'ledger.jsonl')

export type LedgerEntry = Papers & (
  /** A verdict on a visitor; `against` is set when the visitor was an incident. */
  | { type: 'stamp'; at: string; toolUseId: string; against?: string; decision: Decision; covers?: string[] }
  /** A complaint against an earlier stamp; toolUseId is the incident visitor it created. */
  | { type: 'complaint'; at: string; toolUseId: string; against: string; reason: string }
)

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
  writeAtomic(file, { kind: 'permission', form, arrivedAt } satisfies HallEntry)
}

export function listHall(dir: string, now = new Date()): Visitor[] {
  let files: string[]
  try { files = readdirSync(hallDir(dir)) } catch { return [] }
  const ledger = readLedger(dir)
  const who = (p: Papers) => { const character = characterOf(p); return { character, trust: trustOf(ledger, character.id) } }
  return files
    .filter((f) => f.endsWith('.json'))
    .map((f) => readEntry(join(hallDir(dir), f)))
    .filter((e): e is HallEntry => e !== null)
    .map((e): Visitor => {
      const waitSeconds = Math.floor((now.getTime() - Date.parse(e.arrivedAt)) / 1000)
      return e.kind === 'incident'
        ? { kind: 'incident', toolUseId: e.id, against: e.against, complaint: e.complaint, ...e.papers, ...who(e.papers), arrivedAt: e.arrivedAt, waitSeconds }
        : e.kind === 'finished'
        ? { kind: 'finished', toolUseId: e.id, ...e.papers, ...who(e.papers), arrivedAt: e.arrivedAt, waitSeconds }
        : { kind: 'permission', toolUseId: e.form.tool_use_id, ...papersOf(e.form), ...who(papersOf(e.form)), arrivedAt: e.arrivedAt, waitSeconds }
    })
    .sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt))
}

/**
 * Stamp a waiting visitor and say which session to resume, if any: a tool call's session always
 * (the hook then reads the decision); finished work only when returned, with the note as the prompt.
 * Incidents resume nothing (Admit upholds the complaint, Refuse dismisses it).
 */
export function stamp(dir: string, toolUseId: string, decision: Decision, now = new Date()): Resume | null {
  const hallFile = fileFor(hallDir(dir), toolUseId)
  // The agent acts on this text, so a refusal or return must say something.
  if (decision.verdict === 'refuse' && !decision.reason.trim()) throw new Error('a refusal needs a reason')
  if (decision.verdict === 'return' && !decision.note.trim()) throw new Error('a return needs a note')
  const entry = readEntry(hallFile)
  if (!entry) throw new NotFound(`${toolUseId} is not in the hall`)
  if (entry.kind === 'incident' && decision.verdict === 'return') throw new Error('an incident is upheld or dismissed, not returned')
  const at = now.toISOString()
  const record: LedgerEntry = entry.kind === 'incident'
    ? { type: 'stamp', at, toolUseId, against: entry.against, ...entry.papers, decision }
    : entry.kind === 'finished'
    ? { type: 'stamp', at, toolUseId, ...entry.papers, decision, covers: [entry.papers.toolInput.commits].flat().filter((c): c is string => typeof c === 'string') }
    : { type: 'stamp', at, toolUseId, ...papersOf(entry.form), decision }
  if (entry.kind !== 'incident' && entry.kind !== 'finished') {
    mkdirSync(decisionsDir(dir), { recursive: true })
    writeAtomic(fileFor(decisionsDir(dir), toolUseId), decision)
  }
  // Leave the hall before recording, so a failure can't lead to the same stamp being recorded twice.
  // Only the server writes the ledger, so appends never race.
  rmSync(hallFile)
  appendLedger(dir, record)
  const resume: Resume = { sessionId: record.sessionId, cwd: record.cwd, ...(record.job ? { job: record.job } : {}) }
  if (entry.kind === 'incident') return null
  if (entry.kind === 'finished') return decision.verdict === 'return' ? { ...resume, prompt: decision.note } : null
  return resume
}

/**
 * File a finished run for review. Returns its id, or null when the run actually stopped on a
 * tool call still parked in the hall (that visitor already stands for the session).
 */
export function fileFinished(dir: string, form: FinishedForm, now = new Date()): string | null {
  const id = `fin_${form.session_id}_${now.getTime()}`
  const file = fileFor(hallDir(dir), id) // validates the session id too
  let parked: string[] = []
  try { parked = readdirSync(hallDir(dir)) } catch {}
  if (parked.some((f) => { const e = readEntry(join(hallDir(dir), f)); return e && e.kind !== 'incident' && e.kind !== 'finished' && e.form.session_id === form.session_id })) return null
  const papers: Papers = {
    sessionId: form.session_id, cwd: form.cwd, toolName: 'Finished work',
    toolInput: { message: form.message, commits: form.commits }, ...(form.job ? { job: form.job } : {}),
  }
  mkdirSync(hallDir(dir), { recursive: true })
  writeAtomic(file, { kind: 'finished', id, papers, arrivedAt: now.toISOString() } satisfies HallEntry)
  return id
}

const appendLedger = (dir: string, record: LedgerEntry) => appendFileSync(ledgerFile(dir), JSON.stringify(record) + '\n')

/** Complain about an earlier stamp. Sends an incident visitor to the hall and returns its id. */
export function fileComplaint(dir: string, against: string, reason: string, now = new Date()): string {
  if (!reason.trim()) throw new Error('a complaint needs a reason')
  const id = `inc_${against}`
  fileFor(hallDir(dir), id) // validates the id before anything is read or written
  const ledger = readLedger(dir)
  const target = ledger.find((e) => e.type === 'stamp' && e.toolUseId === against)
  if (!target || target.type !== 'stamp') throw new NotFound(`there is no stamp ${against} to complain about`)
  if (target.against) throw new Error('an incident cannot be complained about')
  if (target.decision.verdict !== 'admit') throw new Error('only an admission can be complained about')
  if (ledger.some((e) => e.type === 'complaint' && e.against === against)) throw new Error(`${against} has already been complained about`)
  const papers: Papers = { sessionId: target.sessionId, cwd: target.cwd, toolName: target.toolName, toolInput: target.toolInput, ...(target.job ? { job: target.job } : {}) }
  const at = now.toISOString()
  // Record first: the ledger is what stops a second complaint, so it must never miss one.
  appendLedger(dir, { type: 'complaint', at, toolUseId: id, against, reason, ...papers })
  mkdirSync(hallDir(dir), { recursive: true })
  writeAtomic(fileFor(hallDir(dir), id), { kind: 'incident', id, against, complaint: reason, papers, arrivedAt: at } satisfies HallEntry)
  return id
}

/** Reads reverts out of a repo's history; the git service in production, a fake in tests. */
export type RevertSource = { reverts(cwd: string): { sha: string; reverted: string[] }[] }

/**
 * Raise a complaint for each admission whose covered commits have been reverted, once per admission.
 * Scans only repos that have admissions with covered commits. Returns the new incident ids, and the
 * errors of any complaint that couldn't be filed (the others still are).
 */
// ponytail: matches the agent's own commit SHAs; reverting a squash or merge commit (GitHub's Revert
// button) isn't seen. Record the PR an admission covered once a GitHub service exists, and match that too.
export function matchReverts(dir: string, git: RevertSource, now = new Date()): { incidents: string[]; errors: string[] } {
  const ledger = readLedger(dir)
  const complained = new Set(ledger.flatMap((e) => (e.type === 'complaint' ? [e.against] : [])))
  const admissions = ledger.filter((e) => e.type === 'stamp' && !e.against && e.decision.verdict === 'admit' && e.covers?.length)
  const raised: string[] = []
  const errors: string[] = []
  for (const cwd of new Set(admissions.map((e) => e.cwd))) {
    for (const revert of git.reverts(cwd)) {
      for (const sha of revert.reverted) {
        // A revert message may name the commit by an abbreviated SHA.
        const admission = admissions.find((e) => e.cwd === cwd && e.type === 'stamp' && e.covers!.some((c) => c.startsWith(sha)) && !complained.has(e.toolUseId))
        if (!admission) continue
        complained.add(admission.toolUseId)
        try { raised.push(fileComplaint(dir, admission.toolUseId, `Commit ${sha.slice(0, 7)} was reverted by ${revert.sha.slice(0, 7)}.`, now)) }
        catch (e) { errors.push(`${admission.toolUseId}: ${(e as Error).message}`) }
      }
    }
  }
  return { incidents: raised, errors }
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

export function readLedger(dir: string): LedgerEntry[] {
  let text: string
  try { text = readFileSync(ledgerFile(dir), 'utf8') } catch { return [] }
  return text.split('\n').flatMap((line) => {
    let e: Record<string, unknown> | null
    try { e = JSON.parse(line) } catch { return [] }
    const strings = ['toolUseId', 'at', 'sessionId', 'cwd', 'toolName'].every((k) => typeof e?.[k] === 'string')
    if (!e || !strings || typeof e.toolInput !== 'object' || e.toolInput === null) return []
    if (e.job !== undefined && typeof e.job !== 'string') return []
    if (e.covers !== undefined && !(Array.isArray(e.covers) && e.covers.every((c) => typeof c === 'string'))) return []
    const ok = e.type === 'stamp' ? parseDecision(e.decision) !== null
      : e.type === 'complaint' && typeof e.against === 'string' && typeof e.reason === 'string'
    return ok ? [e as LedgerEntry] : []
  })
}

// Agent-written text goes into Obsidian; neutralise Markdown and [[wiki links]].
const escapeMd = (t: string) => t.replace(/\s*\n\s*/g, ' ').replace(/[\\`*_[\]<>|#]/g, '\\$&')

const VERB = { admit: 'Admit', refuse: 'Refuse', return: 'Return' } as const
const INCIDENT_VERB = { admit: 'Uphold', refuse: 'Dismiss', return: 'Return' } as const // return is rejected by stamp()

/** Markdown for one local-time day of the ledger (date as YYYY-MM-DD). */
export function dailySummary(entries: LedgerEntry[], date: string): string {
  const day = entries.filter((e) => new Date(e.at).toLocaleDateString('sv-SE') === date)
  const stamps = day.flatMap((e) => (e.type === 'stamp' ? [e] : []))
  const calls = stamps.filter((e) => !e.against)
  const incidents = stamps.filter((e) => e.against)
  const complaints = day.length - stamps.length
  const count = (list: typeof stamps, v: Decision['verdict']) => list.filter((e) => e.decision.verdict === v).length
  const lines = day.map((e) => {
    const time = new Date(e.at).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
    const where = `${escapeMd(e.toolName)} in \`${basename(e.cwd).replaceAll('`', "'")}\``
    if (e.type === 'complaint') return `- ${time} **Complaint** against ${where}: ${escapeMd(e.reason)}`
    const d = e.decision
    const text = d.verdict === 'refuse' ? d.reason : d.verdict === 'return' ? d.note : ''
    return `- ${time} **${(e.against ? INCIDENT_VERB : VERB)[d.verdict]}** ${e.against ? 'complaint about ' : ''}${where}${text && `: ${escapeMd(text)}`}`
  })
  return [
    `# Bureau ledger ${date}`,
    '',
    '_Generated by Prompts Please after each stamp; edits here are overwritten._',
    '',
    `${calls.length} stamp${calls.length === 1 ? '' : 's'}: ${count(calls, 'admit')} admitted, ${count(calls, 'refuse')} refused, ${count(calls, 'return')} returned.`
      + (complaints || incidents.length
        ? ` ${complaints} complaint${complaints === 1 ? '' : 's'} filed: ${count(incidents, 'admit')} upheld, ${count(incidents, 'refuse')} dismissed.`
        : ''),
    '',
    ...lines,
    '',
  ].join('\n')
}
