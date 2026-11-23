import type { ClientMessage, ServerMessage } from '@asteroids/shared'
import type { ITransport } from './ITransport'

type WorkerOutMessage = ServerMessage | { t: 'READY' }

export class LocalTransport implements ITransport {
  private worker: Worker | null = null
  private readonly listeners = new Set<(msg: ServerMessage) => void>()
  private closed = false

  connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Transport is closed'))
    }
    if (this.worker) {
      return Promise.resolve()
    }

    const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker

    return new Promise<void>((resolve) => {
      const onReady = (e: MessageEvent<WorkerOutMessage>) => {
        const data = e.data
        if (data && typeof data === 'object' && 't' in data && data.t === 'READY') {
          worker.removeEventListener('message', onReady as EventListener)
          resolve()
        }
      }
      worker.addEventListener('message', onReady as EventListener)
      worker.addEventListener('message', this.handleMessage as EventListener)
      worker.postMessage({ t: 'START' })
    })
  }

  private readonly handleMessage = (e: MessageEvent<WorkerOutMessage>): void => {
    if (this.closed) return
    const data = e.data
    if (!data || typeof data !== 'object' || !('t' in data)) return
    if (data.t === 'READY') return
    const msg = data as ServerMessage
    for (const cb of this.listeners) {
      cb(msg)
    }
  }

  send(msg: ClientMessage): void {
    if (this.closed || !this.worker) return
    this.worker.postMessage(msg)
  }

  onMessage(cb: (msg: ServerMessage) => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleMessage as EventListener)
      this.worker.terminate()
      this.worker = null
    }
  }
}
