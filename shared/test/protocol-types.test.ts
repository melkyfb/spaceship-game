import { describe, expect, it } from 'vitest'
import {
  CLIENT_MESSAGE_TYPES,
  isClientMessageType,
  type ClientMessage,
  type ServerMessage,
} from '../src/types'

describe('M5 protocol types', () => {
  it('CLIENT_MESSAGE_TYPES includes all M5 client message kinds', () => {
    expect(CLIENT_MESSAGE_TYPES).toEqual([
      'JOIN',
      'INPUT_BATCH',
      'PING',
      'RESPAWN_REQUEST',
      'QUIT',
    ])
  })

  it('isClientMessageType accepts known types and rejects unknown', () => {
    for (const t of CLIENT_MESSAGE_TYPES) {
      expect(isClientMessageType(t)).toBe(true)
    }
    expect(isClientMessageType('UNKNOWN')).toBe(false)
    expect(isClientMessageType('join')).toBe(false)
    expect(isClientMessageType('')).toBe(false)
    expect(isClientMessageType(null)).toBe(false)
    expect(isClientMessageType(undefined)).toBe(false)
    expect(isClientMessageType(42)).toBe(false)
  })

  it('ClientMessage union accepts RESPAWN_REQUEST and QUIT', () => {
    const respawn: ClientMessage = { t: 'RESPAWN_REQUEST' }
    const quit: ClientMessage = { t: 'QUIT' }
    expect(respawn.t).toBe('RESPAWN_REQUEST')
    expect(quit.t).toBe('QUIT')
  })

  it('WELCOME supports optional playerToken and protocol', () => {
    const msg: ServerMessage = {
      t: 'WELCOME',
      playerId: 'p1',
      roomId: 'arena',
      serverTick: 0,
      serverTime: 0,
      playerToken: 'opaque-token',
      protocol: 1,
    }
    expect(msg.t).toBe('WELCOME')
    if (msg.t === 'WELCOME') {
      expect(msg.playerToken).toBe('opaque-token')
      expect(msg.protocol).toBe(1)
    }
  })

  it('PLAYER_DEATH event carries extended attribution fields', () => {
    const msg: ServerMessage = {
      t: 'EVENT',
      kind: 'PLAYER_DEATH',
      pos: [1, 2, 3],
      scale: 2,
      playerId: 'p1',
      killerId: 42,
      killerKind: 'ENEMY',
      respawnDelaySec: 3,
    }
    expect(msg.t).toBe('EVENT')
    if (msg.t === 'EVENT' && msg.kind === 'PLAYER_DEATH') {
      expect(msg.playerId).toBe('p1')
      expect(msg.killerId).toBe(42)
      expect(msg.killerKind).toBe('ENEMY')
      expect(msg.respawnDelaySec).toBe(3)
    }
  })

  it('SCORE_RECORDED event carries score recording fields', () => {
    const msg: ServerMessage = {
      t: 'EVENT',
      kind: 'SCORE_RECORDED',
      pos: [0, 0, 0],
      scale: 0,
      playerId: 'p1',
      name: 'Pilot',
      score: 1200,
      wave: 4,
      rank: 2,
    }
    if (msg.t === 'EVENT' && msg.kind === 'SCORE_RECORDED') {
      expect(msg.playerId).toBe('p1')
      expect(msg.name).toBe('Pilot')
      expect(msg.score).toBe(1200)
      expect(msg.wave).toBe(4)
      expect(msg.rank).toBe(2)
    }
  })

  it('LEADERBOARD server message has scope, entries, and optional current', () => {
    const msg: ServerMessage = {
      t: 'LEADERBOARD',
      scope: 'GLOBAL',
      entries: [{ rank: 1, name: 'Ace', score: 9000 }],
      current: { rank: 3, name: 'Pilot', score: 1200 },
    }
    expect(msg.t).toBe('LEADERBOARD')
    if (msg.t === 'LEADERBOARD') {
      expect(msg.scope).toBe('GLOBAL')
      expect(msg.entries[0]).toEqual({ rank: 1, name: 'Ace', score: 9000 })
      expect(msg.current?.rank).toBe(3)
    }
  })

  it('SNAPSHOT gameOver remains optional/deprecated compatibility field', () => {
    const withFlag: ServerMessage = {
      t: 'SNAPSHOT',
      tick: 1,
      serverTime: 0,
      ships: [],
      asteroids: [],
      enemies: [],
      projectiles: [],
      pickups: [],
      wave: 1,
      gameOver: false,
    }
    const withoutFlag: ServerMessage = {
      t: 'SNAPSHOT',
      tick: 1,
      serverTime: 0,
      ships: [],
      asteroids: [],
      enemies: [],
      projectiles: [],
      pickups: [],
      wave: 1,
    }
    if (withFlag.t === 'SNAPSHOT') expect(withFlag.gameOver).toBe(false)
    if (withoutFlag.t === 'SNAPSHOT') expect(withoutFlag.gameOver).toBeUndefined()
  })
})
