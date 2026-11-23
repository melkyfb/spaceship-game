import type { ClientMessage, ServerMessage } from '@asteroids/shared'
import type { ITransport } from './ITransport'

type WorkerOutMessage = ServerMessage | { t: 'READY' }

interface PendingConnect {
  resolve: () => void
  reject: (err: Error) => void
  onReady: EventListener
  onError: EventListener
  onMessageError: EventListener
}

export class LocalTransport implements ITransport {
  private worker: Worker | null = null
  private readonly listeners = new Set<(msg: ServerMessage) => void>()
  private closed = false
  private pendingConnect: PendingConnect | null = null

  connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Transport is closed'))
    }
    if (this.worker && !this.pendingConnect) {
      return Promise.resolve()
    }
    if (this.pendingConnect) {
      return Promise.reject(new Error('Transport is already connecting'))
    }

    const worker = new Worker(new URL('./local.worker.ts', import.meta.url), { type: 'module' })
    this.worker = worker

    return new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanupPendingListeners = (): void => {
        worker.removeEventListener('message', onReady)
        worker.removeEventListener('error', onError)
        worker.removeEventListener('messageerror', onMessageError)
      }

      const settleResolve = (): void => {
        if (settled) return
        settled = true
        if (this.pendingConnect?.onReady === onReady) this.pendingConnect = null
        cleanupPendingListeners()
        resolve()
      }

      const settleReject = (err: Error): void => {
        if (settled) return
        settled = true
        if (this.pendingConnect?.onReady === onReady) this.pendingConnect = null
        cleanupPendingListeners()
        reject(err)
      }

      const onReady: EventListener = (e) => {
        const data = (e as MessageEvent<WorkerOutMessage>).data
        if (data && typeof data === 'object' && 't' in data && data.t === 'READY') {
          settleResolve()
        }
      }

      const onError: EventListener = () => {
        settleReject(new Error('Worker error during connect'))
      }

      const onMessageError: EventListener = () => {
        settleReject(new Error('Worker message error during connect'))
      }

      this.pendingConnect = { resolve: settleResolve, reject: settleReject, onReady, onError, onMessageError }

      worker.addEventListener('message', onReady)
      worker.addEventListener('error', onError)
      worker.addEventListener('messageerror', onMessageError)
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
    if (this.closed || !this.worker || this.pendingConnect) return
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

    const pending = this.pendingConnect
    this.pendingConnect = null

    if (this.worker) {
      if (pending) {
        this.worker.removeEventListener('message', pending.onReady)
        this.worker.removeEventListener('error', pending.onError)
        this.worker.removeEventListener('messageerror', pending.onMessageError)
      }
      this.worker.removeEventListener('message', this.handleMessage as EventListener)
      try {
        this.worker.postMessage({ t: 'STOP' })
      } catch {
        // ignore - worker may already be unavailable
      }
      this.worker.terminate()
      this.worker = null
    }

    if (pending) {
      pending.reject(new Error('Transport closed during connect'))
    }
  }
}
