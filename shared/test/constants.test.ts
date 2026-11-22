import { describe, expect, it } from 'vitest'
import { ASTEROID_TIERS, SHIP_CONFIG, WORLD_CONFIG } from '../src/constants'

describe('spec constants', () => {
  it('matches world config from spec', () => {
    expect(WORLD_CONFIG.ARENA_RADIUS).toBe(500)
    expect(WORLD_CONFIG.SOFT_BOUNDARY_START).toBe(450)
    expect(WORLD_CONFIG.HARD_BOUNDARY_LIMIT).toBe(515)
    expect(WORLD_CONFIG.BOUNDARY_SPRING_K).toBe(140)
    expect(WORLD_CONFIG.BOUNDARY_RADIAL_DAMPING).toBe(3.0)
    expect(WORLD_CONFIG.FIXED_TICK_RATE).toBe(30)
    expect(WORLD_CONFIG.NETWORK_BROADCAST_RATE).toBe(20)
    expect(WORLD_CONFIG.INTERPOLATION_DELAY_MS).toBe(100)
    expect(WORLD_CONFIG.MAX_PLAYERS_PER_ROOM).toBe(8)
  })

  it('matches ship and asteroid tiers from spec', () => {
    expect(SHIP_CONFIG.MAX_SPEED).toBe(65)
    expect(SHIP_CONFIG.BOOST_MULTIPLIER).toBe(1.75)
    expect(SHIP_CONFIG.LINEAR_DRAG).toBe(1.8)
    expect(SHIP_CONFIG.THRUST_ACCEL).toBe(117)
    expect(ASTEROID_TIERS.LARGE).toEqual({ radius: 14, hp: 60, speed: 12, score: 100, children: 3, nextTier: 'MEDIUM' })
    expect(ASTEROID_TIERS.SMALL.nextTier).toBeNull()
  })
})
