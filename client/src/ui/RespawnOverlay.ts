export interface RespawnOverlayCallbacks {
  onRespawn: () => void
  onQuit: () => void
}

export interface RespawnOverlayUpdate {
  killerName?: string
  countdownSec?: number
  canRespawn?: boolean
  visible?: boolean
}

const ROOT_CLASS = 'm5-respawn-overlay'

function ensureStyles(doc: Document): void {
  const id = 'm5-respawn-overlay-styles'
  if (doc.getElementById(id)) return
  const style = doc.createElement('style')
  style.id = id
  style.textContent = `
.${ROOT_CLASS}{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,6,10,0.62);color:#f1f5ff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;z-index:60}
.${ROOT_CLASS}.is-hidden{display:none}
.${ROOT_CLASS} .panel{width:min(92vw,28rem);padding:1.25rem;border:1px solid #6a3a47;border-radius:0.75rem;background:rgba(24,14,20,0.95);box-shadow:0 12px 40px rgba(0,0,0,0.5);text-align:center}
.${ROOT_CLASS} h2{margin:0 0 0.5rem;font-size:1.45rem;color:#ffb3bf}
.${ROOT_CLASS} .killer{margin:0 0 0.75rem;color:#f3d7dc;font-size:1rem}
.${ROOT_CLASS} .countdown{margin:0 0 1rem;font-size:2rem;font-weight:700;color:#fff;font-variant-numeric:tabular-nums}
.${ROOT_CLASS} .countdown.ready{color:#9ef0b0}
.${ROOT_CLASS} .actions{display:flex;gap:0.75rem;justify-content:center}
.${ROOT_CLASS} button{min-width:8rem;padding:0.7rem 1rem;border-radius:0.55rem;border:1px solid #5a6078;background:#252c42;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.${ROOT_CLASS} button.primary{background:#2f7a49;border-color:#67d28a}
.${ROOT_CLASS} button:disabled{opacity:0.45;cursor:not-allowed;filter:saturate(0.4)}
.${ROOT_CLASS} button:not(:disabled):hover{filter:brightness(1.08)}
`
  doc.head.appendChild(style)
}

function formatCountdown(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return safe.toFixed(1)
}

export class RespawnOverlay {
  private readonly callbacks: RespawnOverlayCallbacks
  private root: HTMLDivElement | null = null
  private killerEl: HTMLParagraphElement | null = null
  private countdownEl: HTMLDivElement | null = null
  private respawnBtn: HTMLButtonElement | null = null
  private quitBtn: HTMLButtonElement | null = null
  private canRespawn = false

  constructor(callbacks: RespawnOverlayCallbacks) {
    this.callbacks = callbacks
  }

  mount(parent: HTMLElement): void {
    if (this.root && this.root.isConnected) {
      if (this.root.parentElement !== parent) parent.appendChild(this.root)
      return
    }
    if (this.root) this.unmount()

    const doc = parent.ownerDocument
    ensureStyles(doc)

    const root = doc.createElement('div')
    root.className = `${ROOT_CLASS} is-hidden`
    root.setAttribute('data-ui', 'respawn-overlay')

    const panel = doc.createElement('div')
    panel.className = 'panel'

    const title = doc.createElement('h2')
    title.textContent = 'Você foi destruído'

    const killer = doc.createElement('p')
    killer.className = 'killer'
    killer.textContent = 'Causa desconhecida'

    const countdown = doc.createElement('div')
    countdown.className = 'countdown'
    countdown.textContent = '3.0'

    const actions = doc.createElement('div')
    actions.className = 'actions'

    const respawnBtn = doc.createElement('button')
    respawnBtn.type = 'button'
    respawnBtn.className = 'primary'
    respawnBtn.textContent = 'Respawn'
    respawnBtn.disabled = true
    respawnBtn.addEventListener('click', () => {
      if (respawnBtn.disabled) return
      this.callbacks.onRespawn()
    })

    const quitBtn = doc.createElement('button')
    quitBtn.type = 'button'
    quitBtn.textContent = 'Desistir'
    quitBtn.addEventListener('click', () => {
      this.callbacks.onQuit()
    })

    actions.append(respawnBtn, quitBtn)
    panel.append(title, killer, countdown, actions)
    root.appendChild(panel)
    parent.appendChild(root)

    this.root = root
    this.killerEl = killer
    this.countdownEl = countdown
    this.respawnBtn = respawnBtn
    this.quitBtn = quitBtn
    this.applyRespawnState()
  }

  unmount(): void {
    this.root?.remove()
    this.root = null
    this.killerEl = null
    this.countdownEl = null
    this.respawnBtn = null
    this.quitBtn = null
  }

  show(): void {
    this.root?.classList.remove('is-hidden')
  }

  hide(): void {
    this.root?.classList.add('is-hidden')
  }

  update(update: RespawnOverlayUpdate): void {
    if (update.killerName !== undefined && this.killerEl) {
      const name = update.killerName.trim()
      this.killerEl.textContent = name.length > 0 ? `Você foi destruído por ${name}` : 'Causa desconhecida'
    }
    if (update.countdownSec !== undefined && this.countdownEl) {
      this.countdownEl.textContent = formatCountdown(update.countdownSec)
      this.countdownEl.classList.toggle('ready', update.countdownSec <= 0)
    }
    if (update.canRespawn !== undefined) {
      this.canRespawn = update.canRespawn
      this.applyRespawnState()
    }
    if (update.visible !== undefined) {
      if (update.visible) this.show()
      else this.hide()
    }
  }

  private applyRespawnState(): void {
    if (this.respawnBtn) this.respawnBtn.disabled = !this.canRespawn
  }
}
