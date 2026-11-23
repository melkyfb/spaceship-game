import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decode, encode } from '@msgpack/msgpack'
import type { ClientMessage, ServerMessage } from '@asteroids/shared'
import { WsTransport } from '../../src/net/WsTransport'

class MockWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly url: string
  binaryType: BinaryType = 'blob'
  readyState = MockWebSocket.CONNECTING
  readonly sent: unknown[] = []
  private readonly listeners = new Map<string, Set<EventListener>>()

  constructor(url: string | URL) {
    this.url = String(url)
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: unknown): void {
    this.sent.push(data)
  }

  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return
    this.readyState = MockWebSocket.CLOSED
    this.dispatch('close', {})
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN
    this.dispatch('open', {})
  }

  emitMessage(data: unknown): void {
    this.dispatch('message', { data })
  }

  emitError(): void {
    this.dispatch('error', {})
  }

  private dispatch(type: string, event: Record<string, unknown>): void {
    const e = { type, ...event } as unknown as Event
    const set = this.listeners.get(type)
    if (set) {
      for (const listener of set) listener(e)
    }
  }
}

describe('WsTransport', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('connect resolves on open and configures binary transport', async () => {
    const transport = new WsTransport('ws://localhost:8080')
    const connectPromise = transport.connect()
    const ws = MockWebSocket.instances[0]
    expect(ws).toBeDefined()
    expect(ws!.url).toBe('ws://localhost:8080')
    expect(ws!.binaryType).toBe('arraybuffer')

    ws!.open()
    await expect(connectPromise).resolves.toBeUndefined()
  })

  it('send encodes ClientMessage as msgpack binary', async () => {
    const transport = new WsTransport('ws://localhost:8080')
    const p = transport.connect()
    const ws = MockWebSocket.instances[0]!
    ws.open()
    await p

    const msg: ClientMessage = {
      t: 'INPUT_BATCH',
      cmds: [
        {
          tick: 7,
          thrust: 1,
          strafeX: 0,
          strafeY: -0.5,
          yaw: 0.25,
          pitch: 0,
          roll: 0,
          firePrimary: true,
          fireSecondary: false,
          boost: false,
        },
      ],
    }

    transport.send(msg)

    expect(ws.sent).toHaveLength(1)
    const raw = ws.sent[0]
    const bytes =
      raw instanceof Uint8Array
        ? raw
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : ArrayBuffer.isView(raw)
            ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
            : null
    expect(bytes).not.toBeNull()
    expect(decode(bytes!)).toEqual(msg)
  })

  it('decodes msgpack ServerMessage and delivers to subscribers', async () => {
    const transport = new WsTransport('ws://localhost:8080')
    const p = transport.connect()
    const ws = MockWebSocket.instances[0]!
    ws.open()
    await p

    const received: ServerMessage[] = []
    const off = transport.onMessage((msg) => received.push(msg))

    const snapshot: ServerMessage = {
      t: 'SNAPSHOT',
      tick: 10,
      serverTime: 1.5,
      ships: [],
      asteroids: [],
      enemies: [],
      projectiles: [],
      pickups: [],
      wave: 2,
    }
    const pong: ServerMessage = { t: 'PONG', clientTime: 123, serverTime: 456 }

    ws.emitMessage(encode(snapshot))

    const pongBytes = encode(pong)
    const pongBuffer = pongBytes.buffer.slice(
      pongBytes.byteOffset,
      pongBytes.byteOffset + pongBytes.byteLength,
    )
    ws.emitMessage(pongBuffer)

    expect(received).toEqual([snapshot, pong])

    off()
    ws.emitMessage(encode({ t: 'EVENT', kind: 'HIT', pos: [0, 0, 0], scale: 1 }))
    expect(received).toHaveLength(2)
  })

  it('close closes socket and prevents further delivery/send', async () => {
    const transport = new WsTransport('ws://localhost:8080')
    const p = transport.connect()
    const ws = MockWebSocket.instances[0]!
    ws.open()
    await p

    const received: ServerMessage[] = []
    transport.onMessage((msg) => received.push(msg))

    transport.close()
    expect(ws.readyState).toBe(MockWebSocket.CLOSED)

    ws.emitMessage(encode({ t: 'PONG', clientTime: 1, serverTime: 2 }))
    expect(received).toHaveLength(0)

    expect(() => transport.send({ t: 'PING', clientTime: 1 })).not.toThrow()
    expect(ws.sent).toHaveLength(0)
  })
})
