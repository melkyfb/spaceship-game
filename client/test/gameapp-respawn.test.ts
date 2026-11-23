import { describe, expect, it } from 'vitest'
import { WORLD_CONFIG } from '@asteroids/shared'
import {
  isRespawnReady,
  respawnCountdownSec,
  selectKillerCameraTarget,
  shouldRecordScore,
} from '../src/core/m5-flow'

describe('m5-flow pure helpers', () => {
  describe('respawnCountdownSec / isRespawnReady', () => {
    it('counts down from configured delay and clamps at zero', () => {
      expect(respawnCountdownSec(WORLD_CONFIG.RESPAWN_DELAY_SEC, 0)).toBe(3)
      expect(respawnCountdownSec(WORLD_CONFIG.RESPAWN_DELAY_SEC, 1.25)).toBeCloseTo(1.75, 5)
      expect(respawnCountdownSec(WORLD_CONFIG.RESPAWN_DELAY_SEC, 3)).toBe(0)
      expect(respawnCountdownSec(WORLD_CONFIG.RESPAWN_DELAY_SEC, 4.2)).toBe(0)
    })

    it('becomes ready only when delay has elapsed', () => {
      expect(isRespawnReady(WORLD_CONFIG.RESPAWN_DELAY_SEC, 0)).toBe(false)
      expect(isRespawnReady(WORLD_CONFIG.RESPAWN_DELAY_SEC, 2.999)).toBe(false)
      expect(isRespawnReady(WORLD_CONFIG.RESPAWN_DELAY_SEC, 3)).toBe(true)
      expect(isRespawnReady(WORLD_CONFIG.RESPAWN_DELAY_SEC, 10)).toBe(true)
    })

    it('treats invalid values as ready/zero-safe', () => {
      expect(respawnCountdownSec(Number.NaN, 0)).toBe(0)
      expect(respawnCountdownSec(3, Number.NaN)).toBe(3)
      expect(isRespawnReady(Number.NaN, 0)).toBe(true)
    })
  })

  describe('shouldRecordScore', () => {
    it('records only runs with score > 0', () => {
      expect(shouldRecordScore(0)).toBe(false)
      expect(shouldRecordScore(-1)).toBe(false)
      expect(shouldRecordScore(1)).toBe(true)
      expect(shouldRecordScore(250)).toBe(true)
    })

    it('rejects non-finite scores', () => {
      expect(shouldRecordScore(Number.NaN)).toBe(false)
      expect(shouldRecordScore(Number.POSITIVE_INFINITY)).toBe(false)
    })
  })

  describe('selectKillerCameraTarget', () => {
    it('follows a live enemy killer by id', () => {
      const target = selectKillerCameraTarget(
        { killerKind: 'ENEMY', killerId: 7, killerPos: [10, 0, 0] },
        [{ id: 7, kind: 'ENEMY', pos: [20, 5, -3], alive: true }],
      )
      expect(target).toEqual({ kind: 'entity', entityKind: 'ENEMY', id: 7 })
    })

    it('falls back to impact position when enemy killer is dead/missing', () => {
      const target = selectKillerCameraTarget(
        { killerKind: 'ENEMY', killerId: 7, killerPos: [10, 0, 0] },
        [{ id: 7, kind: 'ENEMY', pos: [20, 5, -3], alive: false }],
      )
      expect(target).toEqual({ kind: 'point', pos: [10, 0, 0] })
    })

    it('falls back to impact position for asteroid/unknown killers', () => {
      expect(
        selectKillerCameraTarget({ killerKind: 'ASTEROID', killerId: 3, killerPos: [1, 2, 3] }, []),
      ).toEqual({ kind: 'point', pos: [1, 2, 3] })
      expect(selectKillerCameraTarget({ killerKind: 'UNKNOWN', killerPos: [4, 5, 6] }, [])).toEqual({
        kind: 'point',
        pos: [4, 5, 6],
      })
    })

    it('uses event pos fallback when killerPos is missing', () => {
      const target = selectKillerCameraTarget({ killerKind: 'UNKNOWN', pos: [9, 8, 7] }, [])
      expect(target).toEqual({ kind: 'point', pos: [9, 8, 7] })
    })
  })
})
