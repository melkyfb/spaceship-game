import { FIXED_DT, GameRoom } from '@asteroids/shared'
import type { ClientMessage, ServerMessage } from '@asteroids/shared'

type WorkerInMessage = ClientMessage | { t: 'START' } | { t: 'STOP' }
type WorkerOutMessage = ServerMessage | { t: 'READY' }

interface WorkerCtx {
  postMessage(msg: WorkerOutMessage): void
  onmessage: ((e: MessageEvent<WorkerInMessage>) => void) | null
  close(): void
}

const ctx = self as unknown as WorkerCtx

let room: GameRoom | null = null
let intervalId: ReturnType<typeof setInterval> | null = null

function post(msg: WorkerOutMessage): void {
  ctx.postMessage(msg)
}

function stopLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function start(): void {
  if (room) return
  room = new GameRoom({ seed: 1, playerId: 'p1', playerName: 'Player', platform: 'PC' })
  post({ t: 'READY' })

  const stepMs = FIXED_DT * 1000
  intervalId = setInterval(() => {
    if (!room) return
    room.stepFixed()

    if (room.shouldEmitSnapshot()) {
      post(room.createSnapshot())
    }

    const events = room.drainEvents()
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]
      if (ev !== undefined) post(ev)
    }
  }, stepMs)
}

function handleClientMessage(msg: ClientMessage): void {
  if (!room) return

  switch (msg.t) {
    case 'INPUT_BATCH':
      room.enqueue(msg.cmds)
      return
    case 'JOIN':
      post({
        t: 'WELCOME',
        playerId: 'p1',
        roomId: msg.roomId,
        serverTick: 0,
        serverTime: 0,
      })
      return
    case 'PING':
      post({
        t: 'PONG',
        clientTime: msg.clientTime,
        serverTime: 0,
      })
      return
  }
}

ctx.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data
  if (!msg || typeof msg !== 'object' || !('t' in msg)) return

  if (msg.t === 'START') {
    start()
    return
  }

  if (msg.t === 'STOP') {
    stopLoop()
    room = null
    ctx.close()
    return
  }

  handleClientMessage(msg as ClientMessage)
}
