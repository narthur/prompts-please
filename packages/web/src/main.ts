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
}

type Verdict = 'admit' | 'refuse' | 'return'
// Shape of core's GET /api/ledger entries (only the fields the booth shows).
type LedgerEntry = {
  at: string
  toolName: string
  cwd: string
  decision: { verdict: Verdict; reason?: string; note?: string }
}

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.textContent = text // never innerHTML: tool input is agent-written
  return node
}

// Draft notes per visitor, so re-rendering or a failed stamp never loses what the operator typed.
const drafts = new Map<string, string>()
let papersKey = ''
let stamping = false
let problem = ''

function render() {
  if (!hall.some((v) => v.toolUseId === selectedId)) selectedId = hall[0]?.toolUseId ?? null

  hallEl.replaceChildren(...hall.map((v) => {
    const li = el('li', `${v.toolName} · ${v.cwd.split('/').pop()} · ${v.waitSeconds}s`)
    li.classList.toggle('selected', v.toolUseId === selectedId)
    li.onclick = () => { selectedId = v.toolUseId; render() }
    return li
  }))
  if (problem) hallEl.prepend(el('li', problem))

  // Only rebuild the papers when the visitor changes, so polling doesn't reset scroll or selection.
  const key = `${selectedId}|${stamping}`
  if (key === papersKey) return
  papersKey = key
  const v = hall.find((x) => x.toolUseId === selectedId)
  if (!v) return papersEl.replaceChildren(el('p', 'The hall is empty.'))
  const note = el('textarea')
  note.placeholder = 'Reason or note for the agent (needed to Refuse or Return)'
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
  stamps.append(button('admit', 'Admit'), button('refuse', 'Refuse'), button('return', 'Return with note'))
  papersEl.replaceChildren(
    el('h3', `${v.toolName} request`),
    el('p', `Project: ${v.cwd}`),
    el('p', `Session: ${v.sessionId}`),
    el('pre', JSON.stringify(v.toolInput, null, 2)),
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
  ledgerEl.replaceChildren(...entries.slice().reverse().map((e) => {
    const time = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const text = e.decision.reason ?? e.decision.note
    return el('li', `${time} ${e.decision.verdict.toUpperCase()} ${e.toolName} · ${e.cwd.split('/').pop()}${text ? ` — ${text}` : ''}`)
  }))
}

async function refresh() {
  const [hallRes, ledgerRes] = await Promise.allSettled([fetch('/api/hall'), fetch('/api/ledger?limit=50')])
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

refresh()
setInterval(refresh, 2000)
