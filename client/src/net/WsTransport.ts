import { decode, encode } from '@msgpack/msgpack'
import type { ClientMessage, ServerMessage } from '@asteroids/shared'
import type { ITransport } from './ITransport'

function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return null
}

function isServerMessage(value: unknown): value is ServerMessage {
  return typeof value === 'object' && value !== null && 't' in value && typeof (value as { t: unknown }).t === 'string'
}

/**
 * WebSocket transport using MessagePack binary encoding.
 * Reconnection is out of scope for M5; close/error results in a failed/closed transport.
 */
export class WsTransport implements ITransport {
  private readonly url: string
  private ws: WebSocket | null = null
  private readonly listeners = new Set<(msg: ServerMessage) => void>()
  private closed = false
  private connecting: Promise<void> | null = null

  constructor(url: string) {
    this.url = url
  }

  connect(): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('Transport is closed'))
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve()
    }
    if (this.connecting) {
      return this.connecting
    }

    const ws = new WebSocket(this.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    this.connecting = new Promise<void>((resolve, reject) => {
      let settled = false

      const cleanup = (): void => {
        ws.removeEventListener('open', onOpen)
        ws.removeEventListener('error', onError)
        ws.removeEventListener('close', onClose)
      }

      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        this.connecting = null
        if (this.ws === ws) this.ws = null
        reject(err)
      }

      const onOpen = (): void => {
        if (settled) return
        settled = true
        cleanup()
        this.connecting = null
        if (this.closed) {
          try {
            ws.close()
          } catch {
            // ignore
          }
          reject(new Error('Transport closed during connect'))
          return
        }
        resolve()
      }

      const onError = (): void => {
        fail(new Error(`WebSocket error connecting to ${this.url}`))
      }

      const onClose = (): void => {
        fail(new Error(`WebSocket closed before open: ${this.url}`))
      }

      ws.addEventListener('open', onOpen)
      ws.addEventListener('error', onError)
      ws.addEventListener('close', onClose)
    })

    ws.addEventListener('message', this.handleMessage as EventListener)
    ws.addEventListener('close', this.handleClose as EventListener)
    ws.addEventListener('error', this.handleError as EventListener)

    return this.connecting
  }

  private readonly handleMessage = (e: MessageEvent<unknown>): void => {
    if (this.closed) return
    const bytes = toUint8Array(e.data)
    if (!bytes) return

    let decoded: unknown
    try {
      decoded = decode(bytes)
    } catch {
      return
    }

    if (!isServerMessage(decoded)) return
    for (const cb of this.listeners) {
      cb(decoded)
    }
  }

  private readonly handleClose = (): void => {
    if (this.closed) return
    this.ws = null
  }

  private readonly handleError = (): void => {
    // Reconnection is out of scope for M5; errors are surfaced through connect/close behavior.
  }

  send(msg: ClientMessage): void {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    try {
      const bytes = encode(msg)
      this.ws.send(bytes)
    } catch {
      // Ignore encode/send failures on a closed or invalid socket.
    }
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
    this.connecting = null

    const ws = this.ws
    this.ws = null
    if (!ws) return

    ws.removeEventListener('message', this.handleMessage as EventListener)
    ws.removeEventListener('close', this.handleClose as EventListener)
    ws.removeEventListener('error', this.handleError as EventListener)

    try {
      ws.close()
    } catch {
      // ignore
    }
  }
}
