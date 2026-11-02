// The booth: Phaser draws the scene; the hall and papers are plain HTML so text stays readable.
import Phaser from 'phaser'

// Shape of core's GET /api/hall. Kept local: web talks to core only over HTTP.
type Visitor = {
  toolUseId: string
  sessionId: string
  cwd: string
  toolName: string
  toolInput: Record<string, unknown>
  waitSeconds: number
  character: { label: string; name: string; portrait: number }
  trust: { admitted: number; complaints: number; level: 'unknown' | 'known' | 'trusted' | 'suspect' }
} & ({ kind: 'permission' } | { kind: 'incident'; against: string; complaint: string } | { kind: 'finished' })

type Verdict = 'admit' | 'refuse' | 'return'
// Shape of core's GET /api/ledger entries (only the fields the booth shows).
type LedgerEntry = { at: string; toolUseId: string; toolName: string; cwd: string; job?: string } & (
  | { type: 'stamp'; against?: string; decision: { verdict: Verdict; reason?: string; note?: string } }
  | { type: 'complaint'; against: string; reason: string }
)

// Shape of core's GET /api/other-window.
type InteractiveSession = { sessionId: string; cwd: string; name: string; status: string; updatedAt: string; character: { name: string; label: string } }

let hall: Visitor[] = []
let selectedId: string | null = null

class Booth extends Phaser.Scene {
  robot!: Phaser.GameObjects.Image
  sign!: Phaser.GameObjects.Text
  preload() {
    this.load.image('booth', '/scenes/booth.png')
    this.load.image('robot', '/characters/busts/bust-1.png')
  }
  create() {
    this.add.image(0, 0, 'booth').setOrigin(0)
    this.robot = this.add.image(156, 120, 'robot').setVisible(false)
    this.sign = this.add.text(6, 4, '', { fontFamily: 'monospace', fontSize: '10px', color: '#ffe9a8', backgroundColor: '#000a' })
  }
  update() {
    this.robot.setVisible(selectedId !== null)
    this.sign.setText(`${hall.length} waiting`)
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'scene',
  width: 312,
  height: 208,
  pixelArt: true,
  scene: Booth,
})

const hallEl = document.querySelector<HTMLUListElement>('#hall')!
const papersEl = document.querySelector<HTMLDivElement>('#papers')!
const ledgerEl = document.querySelector<HTMLOListElement>('#ledger')!
const otherEl = document.querySelector<HTMLUListElement>('#other')!

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = text // never innerHTML: tool input is agent-written
  return node
}

const boardEl = document.querySelector<HTMLDivElement>('#board div')!
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

function interrogation(id: string): HTMLElement {
  const box = el('div')
  box.className = 'interrogation'
  const log = el('div')
  const show = (line: string) => { log.append(el('p', line)); transcripts.set(id, [...(transcripts.get(id) ?? []), line]) }
  for (const line of transcripts.get(id) ?? []) log.append(el('p', line))
  const q = el('input')
  q.placeholder = 'Ask a question (a fresh copy of the agent answers each one; the agent itself is untouched)'
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
  box.append(log, q, ask)
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

  hallEl.replaceChildren(...hall.map((v) => {
    const li = el('li', `${v.kind === 'incident' ? 'INCIDENT · ' : v.kind === 'finished' ? 'DONE · ' : ''}${v.character.name} · ${v.toolName} · ${v.character.label} · ${v.waitSeconds}s`)
    li.classList.toggle('selected', v.toolUseId === selectedId)
    li.onclick = () => { selectedId = v.toolUseId; render() }
    return li
  }))
  if (problem) hallEl.prepend(el('li', problem))

  showBoard(selectedId) // outside the papers check below, so a failed load is retried on the next poll
  // Only rebuild the papers when the visitor changes, so polling doesn't reset scroll or selection.
  const key = `${selectedId}|${stamping}`
  if (key === papersKey) return
  papersKey = key
  const v = hall.find((x) => x.toolUseId === selectedId)
  if (!v) return papersEl.replaceChildren(el('p', 'The hall is empty.'))
  const note = el('textarea')
  note.placeholder = v.kind === 'incident' ? 'Reason (needed to Dismiss)' : 'Reason or note for the agent (needed to Refuse or Return)'
  note.rows = 3
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
      ? [el('h3', 'Incident report'), el('p', `Complaint about stamp ${v.against}: ${v.complaint}`), el('p', 'Admit upholds the complaint; Refuse dismisses it.')]
      : v.kind === 'finished'
      ? [el('h3', 'Finished work'), el('p', 'Return sends the note to the agent as its next instruction. Refuse closes it; the reason stays in the ledger.')]
      : [el('h3', `${v.toolName} request`)]),
    el('p', `Project: ${v.cwd}`),
    el('p', `Session: ${v.sessionId}`),
    ...(v.kind === 'finished'
      ? [el('pre', String(v.toolInput.message ?? '')), el('p', `Commits: ${(v.toolInput.commits as string[] | undefined)?.join(', ') || 'none'}`)]
      : [el('pre', JSON.stringify(v.toolInput, null, 2))]),
    interrogation(v.toolUseId),
    note,
    stamps,
  )
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

async function refresh() {
  const [hallRes, ledgerRes, otherRes] = await Promise.allSettled([fetch('/api/hall'), fetch('/api/ledger?limit=50'), fetch('/api/other-window')])
  try {
    if (hallRes.status === 'rejected') problem = 'Bureau unreachable'
    else if (hallRes.value.ok) { hall = await hallRes.value.json(); problem = '' }
    else problem = `Bureau error: ${await errorText(hallRes.value)}`
  } catch {
    problem = 'Bureau sent an unreadable hall'
  }
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
  stamping = true
  render()
  try {
    const res = await fetch(`/api/hall/${encodeURIComponent(toolUseId)}/stamp`, {
      method: 'POST',
      headers: { 'X-Prompts-Please': '1', 'content-type': 'application/json' },
      body: JSON.stringify(verdict === 'admit' ? { verdict } : verdict === 'refuse' ? { verdict, reason: text } : { verdict, note: text }),
    })
    if (res.ok) drafts.delete(toolUseId)
    else alert(`Stamp failed: ${await errorText(res)}`)
  } catch {
    alert('Stamp failed: bureau unreachable')
  }
  stamping = false
  await refresh()
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
