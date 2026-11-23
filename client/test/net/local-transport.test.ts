import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientMessage, ServerMessage } from '@asteroids/shared'
import { LocalTransport } from '../../src/net/LocalTransport'

class MockWorker {
  static instances: MockWorker[] = []

  onmessage: ((e: MessageEvent<unknown>) => void) | null = null
  onerror: ((e: ErrorEvent) => void) | null = null
  readonly posted: unknown[] = []
  terminated = false
  readonly url: string | URL
  readonly options?: WorkerOptions
  private readonly listeners = new Map<string, Set<EventListener>>()

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url
    this.options = options
    MockWorker.instances.push(this)
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

  postMessage(msg: unknown): void {
    this.posted.push(msg)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(data: unknown): void {
    const event = { data } as MessageEvent<unknown>
    this.onmessage?.(event)
    const set = this.listeners.get('message')
    if (set) {
      for (const listener of set) listener(event as unknown as Event)
    }
  }
}

describe('LocalTransport', () => {
  beforeEach(() => {
    MockWorker.instances = []
    vi.stubGlobal('Worker', MockWorker)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('connect resolves and creates a worker', async () => {
    const transport = new LocalTransport()
    const connectPromise = transport.connect()
    const worker = MockWorker.instances[0]
    expect(worker).toBeDefined()
    worker!.emit({ t: 'READY' })
    await expect(connectPromise).resolves.toBeUndefined()
  })

  it('send forwards client messages to the worker', async () => {
    const transport = new LocalTransport()
    const p = transport.connect()
    const worker = MockWorker.instances[0]!
    worker.emit({ t: 'READY' })
    await p

    const msg: ClientMessage = {
      t: 'INPUT_BATCH',
      cmds: [
        {
          tick: 1,
          thrust: 1,
          strafeX: 0,
          strafeY: 0,
          yaw: 0,
          pitch: 0,
          roll: 0,
          firePrimary: false,
          fireSecondary: false,
          boost: false,
        },
      ],
    }
    transport.send(msg)

    expect(worker.posted).toContainEqual(msg)
  })

  it('onMessage delivers server messages and unsubscribe stops delivery', async () => {
    const transport = new LocalTransport()
    const p = transport.connect()
    const worker = MockWorker.instances[0]!
    worker.emit({ t: 'READY' })
    await p

    const received: ServerMessage[] = []
    const off = transport.onMessage((msg) => received.push(msg))

    const snapshot: ServerMessage = {
      t: 'SNAPSHOT',
      tick: 1,
      serverTime: 1 / 30,
      ships: [],
      asteroids: [],
      enemies: [],
      projectiles: [],
      pickups: [],
      wave: 1,
    }
    const event: ServerMessage = { t: 'EVENT', kind: 'HIT', pos: [0, 0, 0], scale: 1 }
    worker.emit(snapshot)
    worker.emit(event)
    expect(received).toEqual([snapshot, event])

    off()
    worker.emit({ t: 'EVENT', kind: 'EXPLOSION', pos: [1, 2, 3], scale: 2 })
    expect(received).toHaveLength(2)
  })

  it('close terminates worker and prevents further message delivery', async () => {
    const transport = new LocalTransport()
    const p = transport.connect()
    const worker = MockWorker.instances[0]!
    worker.emit({ t: 'READY' })
    await p

    const received: ServerMessage[] = []
    transport.onMessage((msg) => received.push(msg))

    transport.close()
    expect(worker.terminated).toBe(true)

    worker.emit({ t: 'EVENT', kind: 'HIT', pos: [0, 0, 0], scale: 1 })
    expect(received).toHaveLength(0)

    expect(() =>
      transport.send({
        t: 'INPUT_BATCH',
        cmds: [],
      }),
    ).not.toThrow()
  })

  it('rejects connect when closed before READY', async () => {
    const transport = new LocalTransport()
    const connectPromise = transport.connect()
    const worker = MockWorker.instances[0]!
    expect(worker.terminated).toBe(false)

    transport.close()

    await expect(connectPromise).rejects.toThrow('Transport closed during connect')
    expect(worker.terminated).toBe(true)
  })

  it('rejects connect after close', async () => {
    const transport = new LocalTransport()
    const p = transport.connect()
    MockWorker.instances[0]!.emit({ t: 'READY' })
    await p
    transport.close()

    await expect(transport.connect()).rejects.toThrow('Transport is closed')
  })

  it('close is idempotent and does not post messages after close', async () => {
    const transport = new LocalTransport()
    const p = transport.connect()
    const worker = MockWorker.instances[0]!
    worker.emit({ t: 'READY' })
    await p

    transport.send({ t: 'INPUT_BATCH', cmds: [] })
    const postsBeforeClose = worker.posted.length

    transport.close()
    transport.close()

    expect(worker.terminated).toBe(true)
    // No additional postMessage calls after close (STOP was sent once during close).
    expect(worker.posted.length).toBe(postsBeforeClose + 1)
    expect(worker.posted[worker.posted.length - 1]).toEqual({ t: 'STOP' })

    transport.send({ t: 'INPUT_BATCH', cmds: [] })
    expect(worker.posted.length).toBe(postsBeforeClose + 1)
  })
})
