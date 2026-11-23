import './style.css'
import { GameApp } from './core/GameApp'
import type { RenderMode } from './core/RenderPipeline'
import { RENDER_MODE_STORAGE_KEY } from './core/render-config'
import { buildWsUrl } from './ws-status'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing #app mount element')
}

function parseRenderMode(value: string | null): RenderMode | null {
  return value === 'FLAT' || value === 'VR_BOX' || value === 'QUEST_3' ? value : null
}

/** Modo por query `?render=...`, com fallback em localStorage simples (US-06). */
function selectRenderMode(): RenderMode {
  const fromQuery = parseRenderMode(new URLSearchParams(window.location.search).get('render'))
  if (fromQuery !== null) {
    try {
      window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, fromQuery)
    } catch {
      // armazenamento opcional
    }
    return fromQuery
  }
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(RENDER_MODE_STORAGE_KEY)
  } catch {
    // armazenamento opcional
  }
  return parseRenderMode(stored) ?? 'FLAT'
}

const game = new GameApp(root)

const resumeAudioOnGesture = (): void => {
  window.removeEventListener('pointerdown', resumeAudioOnGesture)
  window.removeEventListener('keydown', resumeAudioOnGesture)
  void game.resumeAudioFromGesture()
}
window.addEventListener('pointerdown', resumeAudioOnGesture)
window.addEventListener('keydown', resumeAudioOnGesture)

void game.setRenderMode(selectRenderMode()).then(() => {
  game.start()
})

// Hooks de dev: IPD por [ ] e recenter por R. O mapeamento final (D-Pad/botão X
// do Quest) pertence ao M3 — aqui só expomos os métodos já estruturados.
const handleDevKeyDown = (event: KeyboardEvent): void => {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '[') game.adjustIpd(-1)
  else if (event.key === ']') game.adjustIpd(1)
  else if (event.key.toLowerCase() === 'r') game.recenter()
}
window.addEventListener('keydown', handleDevKeyDown)

// M0 WebSocket diagnostic is kept as an unobtrusive overlay; it stays out of the render loop.
const wsStatus = document.createElement('p')
wsStatus.id = 'ws-status'
wsStatus.className = 'status'
wsStatus.setAttribute('role', 'status')
wsStatus.setAttribute('aria-live', 'polite')
wsStatus.textContent = 'WS: connecting...'
wsStatus.style.position = 'fixed'
wsStatus.style.top = '0.5rem'
wsStatus.style.left = '0.5rem'
wsStatus.style.margin = '0'
wsStatus.style.padding = '0.25rem 0.5rem'
wsStatus.style.borderRadius = '0.25rem'
wsStatus.style.background = 'rgba(5, 7, 15, 0.7)'
wsStatus.style.zIndex = '1'
root.append(wsStatus)

const socket = new WebSocket(buildWsUrl(window.location))

function hasType(data: string, type: string): boolean {
  try {
    const message: unknown = JSON.parse(data)
    return (
      typeof message === 'object' &&
      message !== null &&
      't' in message &&
      (message as { t: unknown }).t === type
    )
  } catch {
    return false
  }
}

socket.addEventListener('open', () => {
  wsStatus.textContent = 'WS: connected'
})

socket.addEventListener('message', (event: MessageEvent<string>) => {
  if (hasType(event.data, 'hello')) {
    wsStatus.textContent = 'WS: hello received'
  }
})

socket.addEventListener('error', () => {
  console.error('[ws] connection error')
  wsStatus.textContent = 'WS: error'
})

socket.addEventListener('close', (event: CloseEvent) => {
  console.info(`[ws] closed: code=${event.code} reason=${event.reason || '(none)'}`)
  wsStatus.textContent = 'WS: closed'
})

window.addEventListener('beforeunload', () => {
  window.removeEventListener('keydown', handleDevKeyDown)
  game.dispose()
})
