// The booth scene: the visitor at the window, its form on the counter, and the stamps.
// Read-only view of state the HTML side owns; the only call in is slam() after a stamp lands.
import Phaser from 'phaser'

export type Verdict = 'admit' | 'refuse' | 'return'
/** Desk objects the operator can click to open a sheet. */
export type DeskObject = 'papers' | 'board' | 'ledger-sheet'
export type SceneVisitor = {
  toolUseId: string
  kind: 'permission' | 'incident' | 'finished'
  toolName: string
  stale: boolean
  toolInput: Record<string, unknown>
  character: { name: string; label: string; portrait: number }
}

const WINDOW_X = 165 // where a visitor stands, centred in the glass
const COUNTER_Y = 166 // top of the counter; visitors stand behind it
const FORM = { x: 92, y: 186 }
const FORM_TEXTURE = { permission: 'form-permission', incident: 'form-complaint', finished: 'form-work' } as const
const BUSTS = 8 // derived busts; characters have 12 portraits, so busts repeat

/** Robot-customs copy: what the visitor says at the window. */
function line(v: SceneVisitor | null): string {
  if (!v) return 'NO ARRIVALS. BOOTH IDLE.'
  const who = v.character.name
  const said = v.kind === 'incident' ? `COMPLAINT LODGED AGAINST ${who}. STAMP UNDER REVIEW.`
    : v.kind === 'finished' ? `${who} REPORTS WORK COMPLETE. ${[v.toolInput.commits].flat().filter(Boolean).length} COMMIT(S) FOR INSPECTION.`
    : `${who} REQUESTS ${v.toolName.toUpperCase()} CLEARANCE. SECTOR: ${v.character.label.toUpperCase()}.`
  return v.stale ? `${said} ...SIGNAL LOST.` : said
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

let audio: AudioContext | null = null
// A synthesized thud, so there are no sound files to ship. Runs after a click, so audio is allowed.
function thud() {
  try {
    audio ??= new AudioContext()
    void audio.resume() // a context made before any click starts suspended
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    const t = audio.currentTime
    osc.frequency.setValueAtTime(140, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15)
    gain.gain.setValueAtTime(0.6, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + 0.2)
  } catch {} // no audio is fine
}

class Booth extends Phaser.Scene {
  visitor: () => SceneVisitor | null
  waiting: () => number
  open: (o: DeskObject) => void
  constructor(visitor: () => SceneVisitor | null, waiting: () => number, open: (o: DeskObject) => void) {
    super('booth')
    this.visitor = visitor
    this.waiting = waiting
    this.open = open
  }
  robot!: Phaser.GameObjects.Image
  form!: Phaser.GameObjects.Image
  speech!: Phaser.GameObjects.Text
  sign!: Phaser.GameObjects.Text
  shownId: string | null = null
  busy = 0 // running animations; arrivals wait until none are left

  preload() {
    this.load.image('booth', '/scenes/booth.png')
    for (let i = 1; i <= BUSTS; i++) this.load.image(`bust-${i}`, `/characters/busts/bust-${i}.png`)
    for (const f of Object.values(FORM_TEXTURE)) this.load.image(f, `/props/${f}.png`)
    this.load.image('directive-board', '/props/directive-board.png')
    this.load.image('ledger', '/props/ledger.png')
    for (const v of ['admit', 'refuse', 'return']) {
      this.load.image(`stamp-${v}`, `/props/stamp-${v}.png`)
      this.load.image(`ink-${v}`, `/props/ink-${v}.png`)
    }
  }

  create() {
    this.add.image(0, 0, 'booth').setOrigin(0)
    this.robot = this.add.image(-60, COUNTER_Y, 'bust-1').setOrigin(0.5, 1).setScale(1.5)
    // The counter, drawn again over the robot so it stands behind it.
    this.add.image(0, 0, 'booth').setOrigin(0).setCrop(0, COUNTER_Y - 4, 312, 208)
    this.form = this.clickable(this.add.image(FORM.x, FORM.y, 'form-permission').setScale(0.25).setAngle(-8).setVisible(false), 'papers')
    // ponytail: positions eyeballed against booth.png's empty wall and counter.
    // The prop images have no alpha, so crop to the board's frame and the book's cover.
    this.clickable(this.add.image(296, 52, 'directive-board').setCrop(24, 8, 264, 192).setScale(0.1), 'board')
    this.clickable(this.add.image(262, 182, 'ledger').setCrop(40, 20, 236, 178).setScale(0.13).setAngle(4), 'ledger-sheet')
    const text = { fontFamily: 'monospace', fontSize: '9px', color: '#ffe9a8', backgroundColor: '#000b', padding: { x: 4, y: 3 } }
    this.speech = this.add.text(WINDOW_X, 30, '', { ...text, wordWrap: { width: 210 }, align: 'center' }).setOrigin(0.5, 0)
    this.sign = this.add.text(6, 4, '', text)
  }

  /** Hand cursor and a warm highlight on hover; a click opens that object's sheet. */
  clickable(img: Phaser.GameObjects.Image, o: DeskObject) {
    return img.setInteractive({ useHandCursor: true })
      .on('pointerover', () => img.setTint(0xfff2b0))
      .on('pointerout', () => img.clearTint())
      .on('pointerdown', () => this.open(o))
  }

  update() {
    this.tweens.timeScale = reducedMotion() ? 20 : 1 // near-instant moves, checked live
    this.sign.setText(`ARRIVALS WAITING: ${this.waiting()}`)
    const v = this.visitor()
    if (!this.busy && (v?.toolUseId ?? null) !== this.shownId) this.arrive(v)
    else if (!this.busy) this.speech.setText(line(v)) // kept fresh, e.g. when it goes stale
  }

  /** Walk the current visitor off to the left, then the next one in from the right. */
  arrive(v: SceneVisitor | null) {
    this.busy++
    this.shownId = v?.toolUseId ?? null
    this.speech.setText('')
    this.form.setVisible(false)
    this.tweens.add({
      targets: this.robot, x: -60, duration: this.robot.x > 0 ? 250 : 0,
      onComplete: () => {
        if (!v) { this.speech.setText(line(null)); this.busy--; return }
        const n = Math.max(1, Math.floor(Number(v.character.portrait)) || 1)
        this.robot.setTexture(`bust-${((n - 1) % BUSTS) + 1}`).setX(372)
        this.tweens.add({
          targets: this.robot, x: WINDOW_X, duration: 450, ease: 'Sine.easeOut',
          onComplete: () => {
            this.form.setTexture(FORM_TEXTURE[v.kind]).setVisible(true)
            this.speech.setText(line(v))
            this.busy--
          },
        })
        this.tweens.add({ targets: this.robot, y: COUNTER_Y - 3, duration: 110, yoyo: true, repeat: 1 }) // a little walk bob
      },
    })
  }

  /** The stamp comes down on the form, leaves its ink, and the visitor leaves. */
  slam(verdict: Verdict) {
    this.busy++
    const stamp = this.add.image(FORM.x, -60, `stamp-${verdict}`).setScale(0.5)
    this.tweens.add({
      targets: stamp, y: FORM.y - 20, duration: 140, ease: 'Quad.easeIn',
      onComplete: () => {
        thud()
        if (!reducedMotion()) this.cameras.main.shake(120, 0.01)
        const ink = this.add.image(FORM.x, FORM.y, `ink-${verdict}`).setScale(0.45).setAngle(Phaser.Math.Between(-12, 12))
        this.tweens.add({ targets: stamp, y: -60, duration: 200, delay: 150, onComplete: () => stamp.destroy() })
        this.time.delayedCall(reducedMotion() ? 35 : 700, () => {
          ink.destroy()
          this.form.setVisible(false)
          this.shownId = '' // whatever is selected next walks in
          this.busy--
        })
      },
    })
  }
}

export function startBooth(parent: string, visitor: () => SceneVisitor | null, waiting: () => number, open: (o: DeskObject) => void): { slam(verdict: Verdict): void } {
  const scene = new Booth(visitor, waiting, open)
  // FIT scales the 312x208 scene to whatever room the layout gives it, so the page never scrolls.
  new Phaser.Game({ type: Phaser.AUTO, parent, width: 312, height: 208, pixelArt: true, scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, scene })
  return { slam: (verdict) => { if (scene.sys.isActive()) scene.slam(verdict) } }
}
