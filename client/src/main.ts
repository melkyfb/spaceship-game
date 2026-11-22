import './style.css'
import { GameApp } from './core/GameApp'
import { buildWsUrl } from './ws-status'

const root = document.querySelector<HTMLDivElement>('#app')

if (!root) {
  throw new Error('Missing #app mount element')
}

const game = new GameApp(root)
game.start()

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
  game.dispose()
})
