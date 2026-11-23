import { describe, expect, it } from 'vitest'
import { ASSET_MANIFEST, getP1AssetUrls } from '../../src/assets/manifest'

describe('asset manifest', () => {
  it('contains P1 ids and runtime urls', () => {
    expect(ASSET_MANIFEST.playerShip.url).toBe('/assets/models/ships/player_ship.glb')
    expect(ASSET_MANIFEST.missile.url).toBe('/assets/models/projectiles/missile.glb')
    expect(ASSET_MANIFEST.pickups.SHIELD_CRYSTAL.url).toContain('/assets/models/pickups/')
    expect(ASSET_MANIFEST.asteroids.LARGE.length).toBeGreaterThan(0)
  })

  it('returns unique preload urls', () => {
    const urls = getP1AssetUrls()
    expect(urls.length).toBe(new Set(urls).size)
    expect(urls.every((u) => u.endsWith('.glb'))).toBe(true)
  })
})
