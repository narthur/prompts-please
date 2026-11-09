// The booth: Phaser draws the scene; the hall and papers are plain HTML so text stays readable.
import { startBooth, type Verdict } from './scene.ts'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import 'highlight.js/styles/github.css'

for (const [name, lang] of Object.entries({ bash, css, diff, go, javascript, json, markdown, python, typescript, xml, yaml })) hljs.registerLanguage(name, lang)
// ponytail: languages by file extension; register more here as agents touch other file types.
const LANG_BY_EXT: Record<string, string> = {
  sh: 'bash', bash: 'bash', zsh: 'bash', css: 'css', go: 'go', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  json: 'json', md: 'markdown', py: 'python', ts: 'typescript', tsx: 'typescript', html: 'xml', xml: 'xml', svg: 'xml', yml: 'yaml', yaml: 'yaml',
}
const langOf = (path: unknown) => LANG_BY_EXT[String(path ?? '').split('.').pop()?.toLowerCase() ?? '']

// Shape of core's GET /api/hall. Kept local: web talks to core only over HTTP.
type Visitor = {
  toolUseId: string
  sessionId: string
  cwd: string
  toolName: string
  toolInput: Record<string, unknown>
  waitSeconds: number
  stale: boolean
  character: { label: string; name: string; portrait: number }
  trust: { admitted: number; complaints: number; level: 'unknown' | 'known' | 'trusted' | 'suspect' }
} & ({ kind: 'permission' } | { kind: 'incident'; against: string; complaint: string } | { kind: 'finished' })

// Shape of core's GET /api/ledger entries (only the fields the booth shows).
type LedgerEntry = { at: string; toolUseId: string; toolName: string; cwd: string; job?: string } & (
  | { type: 'stamp'; against?: string; decision: { verdict: Verdict; reason?: string; note?: string } }
  | { type: 'complaint'; against: string; reason: string }
)

// Shape of core's GET /api/other-window.
type InteractiveSession = { sessionId: string; cwd: string; name: string; status: string; updatedAt: string; character: { name: string; label: string } }

let hall: Visitor[] = []
let selectedId: string | null = null

// Desk objects open sheets over the scene, one at a time; the stamps under the scene stay usable.
type Sheet = 'papers' | 'board' | 'ledger-sheet' | 'other-sheet'
let openSheet: Sheet | null = null
function toggleSheet(name: Sheet | null) {
  openSheet = name === openSheet ? null : name
  document.querySelectorAll<HTMLElement>('.sheet').forEach((s) => s.toggleAttribute('open', s.id === openSheet))
  document.querySelectorAll<HTMLElement>('#objects button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sheet === openSheet)))
}
document.querySelectorAll<HTMLElement>('#objects button').forEach((b) => { b.onclick = () => toggleSheet(b.dataset.sheet as Sheet) })
document.querySelectorAll<HTMLElement>('.sheet [data-close]').forEach((b) => { b.onclick = () => toggleSheet(null) })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheet) toggleSheet(null) })
// Drag a sheet by its title bar; it stays where it was left. Clamped so the bar can't leave the screen.
document.querySelectorAll<HTMLElement>('.sheet header').forEach((bar) => {
  const sheet = bar.parentElement!
  bar.onpointerdown = (e) => {
    if ((e.target as HTMLElement).closest('button')) return
    const r = sheet.getBoundingClientRect()
    const dx = e.clientX - r.left, dy = e.clientY - r.top
    bar.setPointerCapture(e.pointerId)
    bar.onpointermove = (m) => {
      sheet.style.transform = 'none'
      sheet.style.left = `${Math.min(Math.max(m.clientX - dx, 0), innerWidth - 80)}px`
      sheet.style.top = `${Math.min(Math.max(m.clientY - dy, 0), innerHeight - 40)}px`
    }
    bar.onpointerup = () => { bar.onpointermove = null }
  }
})

const booth = startBooth('scene', () => hall.find((v) => v.toolUseId === selectedId) ?? null, () => hall.length, (object) => toggleSheet(object))

const hallEl = document.querySelector<HTMLUListElement>('#hall')!
const papersEl = document.querySelector<HTMLDivElement>('#papers .body')!
const deskEl = document.querySelector<HTMLDivElement>('#desk')!
const ledgerEl = document.querySelector<HTMLOListElement>('#ledger')!
const otherEl = document.querySelector<HTMLUListElement>('#other')!

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = text // never innerHTML: tool input is agent-written
  return node
}

const meta = (text: string) => { const p = el('p', text); p.className = 'meta'; return p }

/** A highlighted code block. hljs escapes its input, so agent-written text can't inject markup. */
function code(text: string, language?: string): HTMLElement {
  const pre = el('pre')
  const c = el('code')
  c.className = 'hljs'
  if (language && hljs.getLanguage(language)) c.innerHTML = hljs.highlight(text, { language }).value
  else c.textContent = text
  pre.append(c)
  return pre
}

/** The tool input as a reviewer reads it: the command, the file and its content, or the edit as a diff. */
function toolView(v: Visitor): HTMLElement[] {
  const i = v.toolInput
  const s = (x: unknown) => (typeof x === 'string' ? x : '')
  const lines = (prefix: string, t: string) => t.split('\n').map((l) => prefix + l).join('\n')
  if (v.toolName === 'Bash' && typeof i.command === 'string')
    return [...(i.description ? [el('p', `Purpose: ${s(i.description)}`)] : []), code(i.command, 'bash')]
  if (v.toolName === 'Write' && typeof i.content === 'string') return [el('p', `File: ${s(i.file_path)}`), code(i.content, langOf(i.file_path))]
  if (v.toolName === 'Edit' && typeof i.old_string === 'string')
    return [el('p', `File: ${s(i.file_path)}${i.replace_all ? ' (every occurrence)' : ''}`), code(`${lines('-', i.old_string)}\n${lines('+', s(i.new_string))}`, 'diff')]
  return [code(JSON.stringify(i, null, 2), 'json')]
}

const boardEl = document.querySelector<HTMLDivElement>('#board .body')!
let boardFor: string | null = null

// Load the rules for the visitor at the booth; a slow reply for an earlier visitor is dropped.
async function showBoard(id: string | null) {
  if (id === boardFor) return
  boardFor = id
  if (!id) return boardEl.replaceChildren()
  boardEl.replaceChildren(el('p', 'Loading…'))
  let content: HTMLElement[]
  let failed = false
  try {
    const res = await fetch(`/api/hall/${encodeURIComponent(id)}/directives`)
    const rules: { source: string; text: string }[] = res.ok ? await res.json() : []
    content = res.ok
      ? rules.flatMap((r) => [el('h4', r.source), el('pre', r.text)])
      : [el('p', `Could not load the rules: ${await errorText(res)}`)]
    if (res.ok && !rules.length) content = [el('p', 'No CLAUDE.md applies to this visitor.')]
    failed = !res.ok
  } catch {
    content = [el('p', 'Could not load the rules: bureau unreachable')]
    failed = true
  }
  if (boardFor !== id) return // the operator moved on to another visitor
  if (failed) boardFor = null // try again on the next poll
  boardEl.replaceChildren(el('p', 'CLAUDE.md files only; imports, CLAUDE.local.md and memory are not shown.'), ...content)
}

// Questions and answers per visitor, kept across re-renders.
const transcripts = new Map<string, string[]>()
const pending = new Set<string>()
const questionDrafts = new Map<string, string>()

function interrogation(id: string): HTMLElement {
  const box = el('div')
  box.className = 'interrogation'
  const log = el('div')
  const show = (line: string) => { log.append(el('p', line)); transcripts.set(id, [...(transcripts.get(id) ?? []), line]) }
  for (const line of transcripts.get(id) ?? []) log.append(el('p', line))
  const q = el('input')
  q.placeholder = 'Ask the agent a question'
  q.title = 'A fresh copy of the agent answers each question; the agent itself is untouched.'
  q.value = questionDrafts.get(id) ?? ''
  q.oninput = () => questionDrafts.set(id, q.value)
  const ask = el('button', 'Interrogate')
  if (pending.has(id)) { ask.disabled = true; ask.textContent = 'Waiting for an answer…' }
  ask.onclick = async () => {
    const question = q.value.trim()
    if (!question) return q.focus()
    pending.add(id)
    ask.disabled = true
    ask.textContent = 'Waiting for an answer…'
    show(`Q: ${question}`)
    q.value = ''
    questionDrafts.delete(id)
    try {
      const res = await fetch(`/api/hall/${encodeURIComponent(id)}/interrogate`, {
        method: 'POST',
        headers: { 'X-Prompts-Please': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      show(res.ok ? `A: ${(await res.json()).answer}` : `(no answer: ${await errorText(res)})`)
    } catch {
      show('(no answer: bureau unreachable)')
    }
    pending.delete(id)
    papersKey = '' // rebuild, so the answer shows even if the papers were redrawn meanwhile
    render()
  }
  const row = el('div')
  row.className = 'ask'
  row.append(q, ask)
  box.append(log, row, el('p', 'A fresh copy of the agent answers; the waiting agent is untouched.'))
  return box
}

// Draft notes per visitor, so re-rendering or a failed stamp never loses what the operator typed.
const drafts = new Map<string, string>()
let papersKey = ''
let stamping = false
let problem = ''

function render() {
  if (!hall.some((v) => v.toolUseId === selectedId)) selectedId = hall[0]?.toolUseId ?? null
  for (const id of transcripts.keys()) if (!hall.some((v) => v.toolUseId === id)) transcripts.delete(id)

  const focused = (document.activeElement as HTMLElement | null)?.dataset.id // rebuilding drops focus; restore it below
  hallEl.replaceChildren(...hall.map((v) => {
    const li = el('li', `${v.stale ? 'STALE · ' : ''}${v.kind === 'incident' ? 'INCIDENT · ' : v.kind === 'finished' ? 'DONE · ' : ''}${v.character.name} · ${v.toolName} · ${v.character.label} · ${v.waitSeconds}s`)
    li.classList.toggle('selected', v.toolUseId === selectedId)
    if (v.toolUseId === selectedId) li.setAttribute('aria-current', 'true')
    li.tabIndex = 0
    li.dataset.id = v.toolUseId
    li.setAttribute('role', 'button')
    li.onclick = () => { selectedId = v.toolUseId; render() }
    li.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.click() } }
    return li
  }))
  if (problem) hallEl.prepend(el('li', problem))
  if (focused) hallEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true })

  showBoard(selectedId) // outside the papers check below, so a failed load is retried on the next poll
  // Only rebuild the papers when the visitor changes, so polling doesn't reset scroll or selection.
  const sel = hall.find((v) => v.toolUseId === selectedId)
  const key = `${selectedId}|${stamping}|${sel?.stale}|${sel?.trust.level}` // a stale flip or trust change redraws
  if (key === papersKey) return
  papersKey = key
  const v = hall.find((x) => x.toolUseId === selectedId)
  if (!v) {
    const cmd = el('code', 'claude -p "<task>" --settings ~/.local/state/prompts-please/agent-settings.json')
    const hint = el('p', 'No visitors. Agents show up here when they need a stamp. Start one from a terminal: ')
    hint.className = 'hint'
    hint.append(cmd)
    deskEl.replaceChildren(hint)
    return papersEl.replaceChildren(el('p', 'The hall is empty.'))
  }
  const note = el('textarea')
  note.placeholder = v.kind === 'incident' ? 'Reason (needed to Dismiss)' : 'Reason or note for the agent (needed to Refuse or Return)'
  note.rows = 2
  note.value = drafts.get(v.toolUseId) ?? ''
  note.oninput = () => drafts.set(v.toolUseId, note.value)
  const button = (verdict: Verdict, label: string) => {
    const b = el('button', stamping ? 'Stamping…' : label)
    b.disabled = stamping
    b.dataset.verdict = verdict
    b.onclick = () => {
      if (verdict !== 'admit' && !note.value.trim()) return note.focus()
      stamp(v.toolUseId, verdict, note.value)
    }
    return b
  }
  const stamps = el('div')
  stamps.className = 'stamps'
  if (v.kind === 'incident') stamps.append(button('admit', 'Uphold'), button('refuse', 'Dismiss'))
  else stamps.append(button('admit', 'Admit'), button('refuse', 'Refuse'), button('return', 'Return with note'))
  const portrait = el('img')
  portrait.src = `/characters/portraits/portrait-${v.character.portrait}.png`
  portrait.alt = ''
  portrait.className = 'portrait'
  const t = v.trust
  papersEl.replaceChildren(
    portrait,
    el('p', `${v.character.name} (${v.character.label}): ${t.level}, ${t.admitted} admitted, ${t.complaints} complaint${t.complaints === 1 ? '' : 's'}`),
    ...(v.kind === 'incident'
      ? [el('h3', 'Incident report'), el('p', `Complaint about stamp ${v.against}: ${v.complaint}`), el('p', 'Uphold agrees with the complaint; Dismiss rejects it.')]
      : v.kind === 'finished'
      ? [el('h3', 'Finished work'), el('p', 'Return sends the note to the agent as its next instruction. Refuse closes it; the reason stays in the ledger.')]
      : [el('h3', `${v.toolName} request`)]),
    ...(v.stale ? [el('p', 'Stale: this session’s transcript is gone, so a stamp cannot resume the agent. It is still recorded.')] : []),
    ...(v.kind === 'finished'
      ? [code(String(v.toolInput.message ?? ''), 'markdown'), el('p', `Commits: ${(v.toolInput.commits as string[] | undefined)?.join(', ') || 'none'}`)]
      : toolView(v)),
    meta(`Project: ${v.cwd}`),
    meta(`Session: ${v.sessionId}`),
    interrogation(v.toolUseId),
  )
  deskEl.replaceChildren(note, stamps)
}

async function errorText(res: Response): Promise<string> {
  try { return (await res.json()).error ?? res.statusText } catch { return `${res.status} ${res.statusText}` }
}

let ledgerKey = ''

function renderLedger(entries: LedgerEntry[]) {
  const key = `${entries.length}|${entries.at(-1)?.at}`
  if (key === ledgerKey) return // unchanged; don't rebuild on every poll
  ledgerKey = key
  const complained = new Set(entries.filter((e) => e.type === 'complaint').map((e) => e.against))
  ledgerEl.replaceChildren(...entries.slice().reverse().map((e) => {
    const time = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const where = `${e.toolName} · ${e.cwd.split('/').pop()}${e.job ? `/${e.job}` : ''}`
    if (e.type === 'complaint') return el('li', `${time} COMPLAINT about ${where} — ${e.reason}`)
    const text = e.decision.reason ?? e.decision.note
    const verb = e.against ? { admit: 'UPHELD', refuse: 'DISMISSED', return: 'RETURNED' }[e.decision.verdict] : e.decision.verdict.toUpperCase()
    const li = el('li', `${time} ${verb} ${e.against ? 'complaint about ' : ''}${where}${text ? ` — ${text}` : ''} `)
    if (!e.against && e.decision.verdict === 'admit' && !complained.has(e.toolUseId)) {
      const b = el('button', 'File complaint')
      b.className = 'small'
      b.onclick = () => complain(e.toolUseId)
      li.append(b)
    }
    return li
  }))
}

// Read-only on purpose: no click handler, no stamp controls.
function renderOther(sessions: InteractiveSession[]) {
  otherEl.replaceChildren(...sessions.map((s) => el('li', `${s.character.name} · ${s.character.label} · ${s.name} · ${s.status}`)))
  if (!sessions.length) otherEl.append(el('li', 'No interactive sessions running.'))
}

// Bumped on every stamp: a poll that started before one may hold a snapshot with the stamped visitor still in it.
let stampEpoch = 0
async function refresh() {
  const epoch = stampEpoch
  const [hallRes, ledgerRes, otherRes] = await Promise.allSettled([fetch('/api/hall'), fetch('/api/ledger?limit=50'), fetch('/api/other-window')])
  let next: Visitor[] | null = null, why = ''
  try {
    if (hallRes.status === 'rejected') why = 'Bureau unreachable'
    else if (hallRes.value.ok) next = await hallRes.value.json()
    else why = `Bureau error: ${await errorText(hallRes.value)}`
  } catch {
    why = 'Bureau sent an unreadable hall'
  }
  if (epoch !== stampEpoch) return // the post-stamp refresh brings the fresh hall
  if (next) hall = next
  problem = why
  render()
  // The ledger is secondary: if it fails, keep showing the last good one.
  try { if (ledgerRes.status === 'fulfilled' && ledgerRes.value.ok) renderLedger(await ledgerRes.value.json()) } catch {}
  try {
    if (otherRes.status === 'fulfilled' && otherRes.value.ok) renderOther(await otherRes.value.json())
    else otherEl.replaceChildren(el('li', 'Could not read the other window.'))
  } catch {
    otherEl.replaceChildren(el('li', 'Could not read the other window.'))
  }
}

async function stamp(toolUseId: string, verdict: Verdict, text: string) {
  // A mouse click doesn't match :focus-visible, so this is set only when the stamp came from the keyboard.
  const pressed = document.activeElement?.matches('button:focus-visible') ? (document.activeElement as HTMLElement).dataset.verdict : undefined
  let ok = false
  stamping = true
  stampEpoch++
  render()
  try {
    const res = await fetch(`/api/hall/${encodeURIComponent(toolUseId)}/stamp`, {
      method: 'POST',
      headers: { 'X-Prompts-Please': '1', 'content-type': 'application/json' },
      body: JSON.stringify(verdict === 'admit' ? { verdict } : verdict === 'refuse' ? { verdict, reason: text } : { verdict, note: text }),
    })
    if (res.ok) { ok = true; drafts.delete(toolUseId); booth.slam(verdict) }
    else alert(`Stamp failed: ${await errorText(res)}`)
  } catch {
    alert('Stamp failed: bureau unreachable')
  }
  stamping = false
  await refresh()
  // The rebuild removed the pressed button. If the visitor has left the hall, put a keyboard user on the newly selected one.
  // If it's still here after a failure, go back to the pressed button to retry. A success with the visitor still shown is a
  // stale hall: leave focus alone, since that entry is about to vanish. Never a stamp button on a different visitor.
  if (!pressed || document.activeElement !== document.body) return
  const target = selectedId !== toolUseId ? hallEl.querySelector<HTMLElement>('[aria-current]') : ok ? null : deskEl.querySelector<HTMLElement>(`button[data-verdict="${pressed}"]`)
  target?.focus({ preventScroll: true })
}

async function complain(toolUseId: string) {
  const reason = prompt('What went wrong with this admission?')
  if (!reason?.trim()) return
  try {
    const res = await fetch(`/api/ledger/${encodeURIComponent(toolUseId)}/complaint`, {
      method: 'POST',
      headers: { 'X-Prompts-Please': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    if (!res.ok) alert(`Complaint failed: ${await errorText(res)}`)
  } catch {
    alert('Complaint failed: bureau unreachable')
  }
  await refresh()
}

async function scanReverts() {
  try {
    const res = await fetch('/api/reverts/scan', { method: 'POST', headers: { 'X-Prompts-Please': '1' } })
    if (!res.ok) return alert(`Scan failed: ${await errorText(res)}`)
    const { incidents, errors } = await res.json()
    alert([
      incidents.length ? `${incidents.length} complaint(s) filed from reverts.` : 'No new reverts of admitted work.',
      ...errors.map((e: string) => `Failed: ${e}`),
    ].join('\n'))
  } catch {
    alert('Scan failed: bureau unreachable')
  }
  await refresh()
}
document.querySelector<HTMLButtonElement>('#scan-reverts')!.onclick = scanReverts

refresh()
setInterval(refresh, 2000)
