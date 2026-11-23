export type StartScreenMode = 'TRAINING' | 'MULTIPLAYER'

export interface StartScreenEntry {
  rank: number
  name: string
  score: number
}

export interface StartScreenCallbacks {
  onTrain: (name: string) => void
  onMultiplayer: (name: string) => void
  onModeChange?: (mode: StartScreenMode) => void
}

export interface StartScreenUpdate {
  name?: string
  mode?: StartScreenMode
  entries?: readonly StartScreenEntry[]
}

const ROOT_CLASS = 'm5-start-screen'

function ensureStyles(doc: Document): void {
  const id = 'm5-start-screen-styles'
  if (doc.getElementById(id)) return
  const style = doc.createElement('style')
  style.id = id
  style.textContent = `
.${ROOT_CLASS}{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,7,15,0.88);color:#e8ecf8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;z-index:50}
.${ROOT_CLASS}.is-hidden{display:none}
.${ROOT_CLASS} .panel{width:min(92vw,34rem);padding:1.25rem;border:1px solid #33406a;border-radius:0.75rem;background:#121a2f;box-shadow:0 12px 40px rgba(0,0,0,0.45)}
.${ROOT_CLASS} h1{margin:0 0 0.25rem;font-size:1.5rem;line-height:1.2}
.${ROOT_CLASS} p.sub{margin:0 0 1rem;color:#9fb3d9;font-size:0.95rem}
.${ROOT_CLASS} label{display:block;margin:0 0 0.35rem;color:#c6d6f3;font-size:0.9rem}
.${ROOT_CLASS} input[type=text]{width:100%;padding:0.65rem 0.75rem;border-radius:0.5rem;border:1px solid #3a4a78;background:#0c1326;color:#e8ecf8;font:inherit;margin-bottom:0.9rem}
.${ROOT_CLASS} .mode-row{display:flex;gap:0.5rem;margin-bottom:0.9rem}
.${ROOT_CLASS} .mode-btn{flex:1;padding:0.55rem 0.75rem;border-radius:0.5rem;border:1px solid #3a4a78;background:#18223d;color:#d7e4ff;font:inherit;cursor:pointer}
.${ROOT_CLASS} .mode-btn.is-active{background:#26437a;border-color:#7fc0ff;color:#fff}
.${ROOT_CLASS} .board{margin:0 0 1rem;border:1px solid #2d395f;border-radius:0.5rem;overflow:hidden}
.${ROOT_CLASS} .board-title{padding:0.5rem 0.75rem;background:#18223d;color:#bcd0f5;font-size:0.85rem;font-weight:600;letter-spacing:0.02em}
.${ROOT_CLASS} table{width:100%;border-collapse:collapse;font-size:0.9rem}
.${ROOT_CLASS} th,.${ROOT_CLASS} td{padding:0.4rem 0.75rem;text-align:left}
.${ROOT_CLASS} th{color:#93abd4;font-weight:600;background:#111a31}
.${ROOT_CLASS} td.rank{width:3.5rem;color:#93abd4}
.${ROOT_CLASS} td.score{width:5.5rem;text-align:right;font-variant-numeric:tabular-nums}
.${ROOT_CLASS} th.score{text-align:right}
.${ROOT_CLASS} tr+tr td{border-top:1px solid #243152}
.${ROOT_CLASS} .empty{padding:0.75rem;color:#93abd4;font-size:0.9rem}
.${ROOT_CLASS} .actions{display:flex;gap:0.75rem}
.${ROOT_CLASS} .action{flex:1;padding:0.7rem 0.9rem;border-radius:0.55rem;border:1px solid #4b78cf;background:#2453a4;color:#fff;font:inherit;font-weight:700;cursor:pointer}
.${ROOT_CLASS} .action.secondary{background:#1a2846;border-color:#3a4a78;color:#d7e4ff}
.${ROOT_CLASS} .action:hover{filter:brightness(1.08)}
.${ROOT_CLASS} .action:active{transform:translateY(1px)}
`
  doc.head.appendChild(style)
}

function sanitizeName(value: string): string {
  return value.trim().slice(0, 32)
}

export class StartScreen {
  private readonly callbacks: StartScreenCallbacks
  private root: HTMLDivElement | null = null
  private parent: HTMLElement | null = null
  private nameInput: HTMLInputElement | null = null
  private trainingBtn: HTMLButtonElement | null = null
  private multiplayerBtn: HTMLButtonElement | null = null
  private boardBody: HTMLTableSectionElement | null = null
  private emptyEl: HTMLDivElement | null = null
  private mode: StartScreenMode = 'TRAINING'
  private entries: StartScreenEntry[] = []

  constructor(callbacks: StartScreenCallbacks) {
    this.callbacks = callbacks
  }

  mount(parent: HTMLElement): void {
    if (this.root && this.parent === parent) {
      if (!this.root.isConnected) parent.appendChild(this.root)
      return
    }
    if (this.root) this.unmount()

    const doc = parent.ownerDocument
    ensureStyles(doc)

    const root = doc.createElement('div')
    root.className = `${ROOT_CLASS} is-hidden`
    root.setAttribute('data-ui', 'start-screen')

    const panel = doc.createElement('div')
    panel.className = 'panel'

    const title = doc.createElement('h1')
    title.textContent = 'Asteroids 3D'

    const sub = doc.createElement('p')
    sub.className = 'sub'
    sub.textContent = 'Escolha o modo, confirme seu nome e entre na arena.'

    const nameLabel = doc.createElement('label')
    nameLabel.textContent = 'Nome do piloto'
    nameLabel.htmlFor = 'm5-start-name'

    const nameInput = doc.createElement('input')
    nameInput.type = 'text'
    nameInput.id = 'm5-start-name'
    nameInput.name = 'pilotName'
    nameInput.maxLength = 32
    nameInput.autocomplete = 'off'
    nameInput.placeholder = 'Seu nome'

    const modeRow = doc.createElement('div')
    modeRow.className = 'mode-row'

    const trainingModeBtn = doc.createElement('button')
    trainingModeBtn.type = 'button'
    trainingModeBtn.className = 'mode-btn is-active'
    trainingModeBtn.textContent = 'Treinamento'
    trainingModeBtn.addEventListener('click', () => {
      this.setMode('TRAINING')
      this.callbacks.onModeChange?.('TRAINING')
    })

    const multiplayerModeBtn = doc.createElement('button')
    multiplayerModeBtn.type = 'button'
    multiplayerModeBtn.className = 'mode-btn'
    multiplayerModeBtn.textContent = 'Multiplayer'
    multiplayerModeBtn.addEventListener('click', () => {
      this.setMode('MULTIPLAYER')
      this.callbacks.onModeChange?.('MULTIPLAYER')
    })

    modeRow.append(trainingModeBtn, multiplayerModeBtn)

    const board = doc.createElement('div')
    board.className = 'board'
    const boardTitle = doc.createElement('div')
    boardTitle.className = 'board-title'
    boardTitle.textContent = 'Top 10'
    const table = doc.createElement('table')
    const thead = doc.createElement('thead')
    const headRow = doc.createElement('tr')
    for (const [label, cls] of [['#', 'rank'], ['Nome', 'name'], ['Placar', 'score']] as const) {
      const th = doc.createElement('th')
      th.textContent = label
      th.className = cls
      headRow.appendChild(th)
    }
    thead.appendChild(headRow)
    const tbody = doc.createElement('tbody')
    table.append(thead, tbody)
    const empty = doc.createElement('div')
    empty.className = 'empty'
    empty.textContent = 'Sem registros ainda.'
    board.append(boardTitle, table, empty)

    const actions = doc.createElement('div')
    actions.className = 'actions'

    const trainAction = doc.createElement('button')
    trainAction.type = 'button'
    trainAction.className = 'action'
    trainAction.textContent = 'Treinar'
    trainAction.addEventListener('click', () => {
      const name = this.readName()
      this.callbacks.onTrain(name)
    })

    const multiAction = doc.createElement('button')
    multiAction.type = 'button'
    multiAction.className = 'action secondary'
    multiAction.textContent = 'Multiplayer'
    multiAction.addEventListener('click', () => {
      const name = this.readName()
      this.callbacks.onMultiplayer(name)
    })

    actions.append(trainAction, multiAction)
    panel.append(title, sub, nameLabel, nameInput, modeRow, board, actions)
    root.appendChild(panel)
    parent.appendChild(root)

    this.root = root
    this.parent = parent
    this.nameInput = nameInput
    this.trainingBtn = trainingModeBtn
    this.multiplayerBtn = multiplayerModeBtn
    this.boardBody = tbody
    this.emptyEl = empty

    this.setMode(this.mode)
    this.renderEntries()
  }

  unmount(): void {
    this.root?.remove()
    this.root = null
    this.parent = null
    this.nameInput = null
    this.trainingBtn = null
    this.multiplayerBtn = null
    this.boardBody = null
    this.emptyEl = null
  }

  show(): void {
    this.root?.classList.remove('is-hidden')
  }

  hide(): void {
    this.root?.classList.add('is-hidden')
  }

  update(update: StartScreenUpdate): void {
    if (update.name !== undefined && this.nameInput) {
      this.nameInput.value = sanitizeName(update.name)
    }
    if (update.mode !== undefined) {
      this.setMode(update.mode)
    }
    if (update.entries !== undefined) {
      this.entries = update.entries.slice(0, 10).map((e) => ({
        rank: e.rank,
        name: e.name,
        score: e.score,
      }))
      this.renderEntries()
    }
  }

  getName(): string {
    return this.readName()
  }

  getMode(): StartScreenMode {
    return this.mode
  }

  private readName(): string {
    const value = this.nameInput?.value ?? ''
    const clean = sanitizeName(value)
    if (this.nameInput && this.nameInput.value !== clean) this.nameInput.value = clean
    return clean
  }

  private setMode(mode: StartScreenMode): void {
    this.mode = mode
    this.trainingBtn?.classList.toggle('is-active', mode === 'TRAINING')
    this.multiplayerBtn?.classList.toggle('is-active', mode === 'MULTIPLAYER')
  }

  private renderEntries(): void {
    const tbody = this.boardBody
    const empty = this.emptyEl
    if (!tbody || !empty) return
    tbody.replaceChildren()
    if (this.entries.length === 0) {
      empty.style.display = 'block'
      return
    }
    empty.style.display = 'none'
    const doc = tbody.ownerDocument
    for (const entry of this.entries) {
      const tr = doc.createElement('tr')
      const rankTd = doc.createElement('td')
      rankTd.className = 'rank'
      rankTd.textContent = String(entry.rank)
      const nameTd = doc.createElement('td')
      nameTd.className = 'name'
      nameTd.textContent = entry.name
      const scoreTd = doc.createElement('td')
      scoreTd.className = 'score'
      scoreTd.textContent = String(entry.score)
      tr.append(rankTd, nameTd, scoreTd)
      tbody.appendChild(tr)
    }
  }
}
