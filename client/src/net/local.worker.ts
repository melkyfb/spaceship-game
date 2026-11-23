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

const LOCAL_PLAYER_ID = 'p1'
const LOCAL_ROOM_ID = 'training'
const LOCAL_PLAYER_TOKEN = 'local-training-token'

let room: GameRoom | null = null
let intervalId: ReturnType<typeof setInterval> | null = null
let tick = 0
let playerId = LOCAL_PLAYER_ID
let playerName = 'Player'
let platform: 'PC' | 'ANDROID_FLAT' | 'VR_BOX' | 'QUEST_3' = 'PC'

function post(msg: WorkerOutMessage): void {
  ctx.postMessage(msg)
}

function stopLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function createRoom(): GameRoom {
  return new GameRoom({
    seed: 1,
    playerId,
    playerName,
    platform,
    gameOverOnDeath: false,
    autoRespawn: false,
  })
}

function start(): void {
  if (room) return
  tick = 0
  playerId = LOCAL_PLAYER_ID
  playerName = 'Player'
  platform = 'PC'
  room = createRoom()
  post({ t: 'READY' })

  const stepMs = FIXED_DT * 1000
  // Training: fixed interval, no catch-up/backpressure. If the worker stalls,
  // ticks are dropped rather than spiraling; acceptable for local solo/training.
  intervalId = setInterval(() => {
    if (!room) return
    room.stepFixed()
    tick += 1

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

  if (msg.t === 'JOIN') {
    const nextName = typeof msg.name === 'string' && msg.name.trim().length > 0 ? msg.name.trim() : playerName
    const nextPlatform = msg.platform ?? platform
    const shouldReset =
      nextName !== playerName || nextPlatform !== platform || !room.hasPlayer(playerId)

    playerName = nextName
    platform = nextPlatform
    if (shouldReset) {
      room = createRoom()
      tick = 0
    }

    post({
      t: 'WELCOME',
      playerId,
      roomId: msg.roomId || LOCAL_ROOM_ID,
      serverTick: tick,
      serverTime: tick * FIXED_DT,
      playerToken: LOCAL_PLAYER_TOKEN,
    })
    return
  }

  if (msg.t === 'PING') {
    post({
      t: 'PONG',
      clientTime: msg.clientTime,
      serverTime: tick * FIXED_DT,
    })
    return
  }

  room.receive(playerId, msg)
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
