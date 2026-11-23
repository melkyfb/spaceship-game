export interface LeaderboardHudEntry {
  rank: number
  name: string
  score: number
}

export interface LeaderboardHudCurrent {
  rank?: number | null
  name: string
  score: number
  bestRank?: number | null
  bestScore?: number | null
}

export interface LeaderboardHudUpdate {
  entries?: readonly LeaderboardHudEntry[]
  current?: LeaderboardHudCurrent | null
  title?: string
}

const ROOT_CLASS = 'm5-leaderboard-hud'

function ensureStyles(doc: Document): void {
  const id = 'm5-leaderboard-hud-styles'
  if (doc.getElementById(id)) return
  const style = doc.createElement('style')
  style.id = id
  style.textContent = `
.${ROOT_CLASS}{position:fixed;top:0.75rem;left:0.75rem;min-width:14rem;max-width:min(22rem,calc(100vw - 1.5rem));padding:0.6rem 0.7rem;border:1px solid rgba(88,120,170,0.55);border-radius:0.55rem;background:rgba(10,16,30,0.72);color:#e8ecf8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:0.82rem;line-height:1.3;z-index:40;pointer-events:none;backdrop-filter:blur(2px)}
.${ROOT_CLASS}.is-hidden{display:none}
.${ROOT_CLASS} .title{margin:0 0 0.35rem;color:#bcd0f5;font-size:0.76rem;font-weight:700;letter-spacing:0.03em;text-transform:uppercase}
.${ROOT_CLASS} table{width:100%;border-collapse:collapse}
.${ROOT_CLASS} th,.${ROOT_CLASS} td{padding:0.12rem 0.15rem;text-align:left;vertical-align:top}
.${ROOT_CLASS} th{color:#93abd4;font-weight:600}
.${ROOT_CLASS} td.rank{width:2.2rem;color:#93abd4;font-variant-numeric:tabular-nums}
.${ROOT_CLASS} td.score,.${ROOT_CLASS} th.score{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.${ROOT_CLASS} td.name{max-width:10rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${ROOT_CLASS} .empty{color:#93abd4;padding:0.2rem 0}
.${ROOT_CLASS} .you{margin-top:0.45rem;padding-top:0.4rem;border-top:1px solid rgba(88,120,170,0.45);color:#f0f6ff}
.${ROOT_CLASS} .you .label{color:#9ef0b0;font-weight:700}
.${ROOT_CLASS} .you .meta{display:block;color:#93abd4;font-size:0.75rem;margin-top:0.1rem}
`
  doc.head.appendChild(style)
}

function formatRank(rank: number | null | undefined): string {
  if (typeof rank !== 'number' || !Number.isFinite(rank) || rank <= 0) return '-'
  return `#${Math.floor(rank)}`
}

export class LeaderboardHud {
  private root: HTMLDivElement | null = null
  private titleEl: HTMLDivElement | null = null
  private bodyEl: HTMLTableSectionElement | null = null
  private emptyEl: HTMLDivElement | null = null
  private youEl: HTMLDivElement | null = null
  private entries: LeaderboardHudEntry[] = []
  private current: LeaderboardHudCurrent | null = null
  private title = 'Top 10'

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
    root.setAttribute('data-ui', 'leaderboard-hud')

    const title = doc.createElement('div')
    title.className = 'title'
    title.textContent = this.title

    const table = doc.createElement('table')
    const thead = doc.createElement('thead')
    const headRow = doc.createElement('tr')
    for (const [label, cls] of [['#', 'rank'], ['Nome', 'name'], ['Score', 'score']] as const) {
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

    const you = doc.createElement('div')
    you.className = 'you'

    root.append(title, table, empty, you)
    parent.appendChild(root)

    this.root = root
    this.titleEl = title
    this.bodyEl = tbody
    this.emptyEl = empty
    this.youEl = you
    this.render()
  }

  unmount(): void {
    this.root?.remove()
    this.root = null
    this.titleEl = null
    this.bodyEl = null
    this.emptyEl = null
    this.youEl = null
  }

  show(): void {
    this.root?.classList.remove('is-hidden')
  }

  hide(): void {
    this.root?.classList.add('is-hidden')
  }

  update(update: LeaderboardHudUpdate): void {
    if (update.title !== undefined) this.title = update.title
    if (update.entries !== undefined) {
      this.entries = update.entries.slice(0, 10).map((e) => ({
        rank: e.rank,
        name: e.name,
        score: e.score,
      }))
    }
    if (update.current !== undefined) {
      this.current = update.current
    }
    this.render()
  }

  private render(): void {
    if (this.titleEl) this.titleEl.textContent = this.title

    const tbody = this.bodyEl
    const empty = this.emptyEl
    const you = this.youEl
    if (!tbody || !empty || !you) return

    tbody.replaceChildren()
    if (this.entries.length === 0) {
      empty.style.display = 'block'
    } else {
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

    you.replaceChildren()
    if (!this.current) {
      you.style.display = 'none'
      return
    }

    you.style.display = 'block'
    const doc = you.ownerDocument
    const main = doc.createElement('div')
    const label = doc.createElement('span')
    label.className = 'label'
    label.textContent = 'Você: '
    const text = doc.createElement('span')
    const rankText = formatRank(this.current.rank)
    text.textContent = `${rankText} ${this.current.name} ${this.current.score}`
    main.append(label, text)
    you.appendChild(main)

    const hasBest = this.current.bestRank != null || this.current.bestScore != null
    if (hasBest) {
      const meta = doc.createElement('span')
      meta.className = 'meta'
      const bestRank = formatRank(this.current.bestRank)
      const bestScore =
        typeof this.current.bestScore === 'number' && Number.isFinite(this.current.bestScore)
          ? Math.floor(this.current.bestScore)
          : '-'
      meta.textContent = `Melhor registrado: ${bestRank} • ${bestScore}`
      you.appendChild(meta)
    }
  }
}
