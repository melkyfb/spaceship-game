import './style.css'
import { GameApp } from './core/GameApp'
import type { RenderMode } from './core/RenderPipeline'
import { RENDER_MODE_STORAGE_KEY } from './core/render-config'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing #app mount element')
}

function parseRenderMode(value: string | null): RenderMode | null {
  return value === 'FLAT' || value === 'VR_BOX' || value === 'QUEST_3' ? value : null
}

function selectRenderMode(): RenderMode {
  const fromQuery = parseRenderMode(new URLSearchParams(window.location.search).get('render'))
  if (fromQuery !== null) {
    try {
      window.localStorage.setItem(RENDER_MODE_STORAGE_KEY, fromQuery)
    } catch {
      // optional storage
    }
    return fromQuery
  }
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(RENDER_MODE_STORAGE_KEY)
  } catch {
    // optional storage
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

const handleDevKeyDown = (event: KeyboardEvent): void => {
  if (event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === '[') game.adjustIpd(-1)
  else if (event.key === ']') game.adjustIpd(1)
  else if (event.key.toLowerCase() === 'r') game.recenter()
}
window.addEventListener('keydown', handleDevKeyDown)

window.addEventListener('beforeunload', () => {
  window.removeEventListener('keydown', handleDevKeyDown)
  game.dispose()
})
