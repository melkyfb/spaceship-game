export type AssetId =
  | 'player_ship'
  | 'missile'
  | 'pickup_shield'
  | 'pickup_energy'
  | `asteroid_${'large' | 'medium' | 'small'}_${string}`

export interface AssetDef {
  id: AssetId
  url: string
  targetRadius?: number
  yawOffsetRad?: number
  pitchOffsetRad?: number
  rollOffsetRad?: number
}

export const ASSET_MANIFEST = {
  playerShip: { id: 'player_ship', url: '/assets/models/ships/player_ship.glb', targetRadius: 2.2, yawOffsetRad: 0 },
  missile: { id: 'missile', url: '/assets/models/projectiles/missile.glb' },
  pickups: {
    SHIELD_CRYSTAL: { id: 'pickup_shield', url: '/assets/models/pickups/crystal_shield.glb', targetRadius: 2.0 },
    ENERGY_CRYSTAL: { id: 'pickup_energy', url: '/assets/models/pickups/crystal_energy.glb', targetRadius: 2.0 },
  },
  asteroids: {
    LARGE: [
      { id: 'asteroid_large_01', url: '/assets/models/asteroids/asteroid_large_01.glb', targetRadius: 14 },
      { id: 'asteroid_large_02', url: '/assets/models/asteroids/asteroid_large_02.glb', targetRadius: 14 },
    ],
    MEDIUM: [
      { id: 'asteroid_medium_01', url: '/assets/models/asteroids/asteroid_medium_01.glb', targetRadius: 7 },
      { id: 'asteroid_medium_02', url: '/assets/models/asteroids/asteroid_medium_02.glb', targetRadius: 7 },
    ],
    SMALL: [
      { id: 'asteroid_small_01', url: '/assets/models/asteroids/asteroid_small_01.glb', targetRadius: 3 },
      { id: 'asteroid_small_02', url: '/assets/models/asteroids/asteroid_small_02.glb', targetRadius: 3 },
    ],
  },
} as const

export function getP1AssetUrls(): string[] {
  const urls = [
    ASSET_MANIFEST.playerShip.url,
    ASSET_MANIFEST.missile.url,
    ASSET_MANIFEST.pickups.SHIELD_CRYSTAL.url,
    ASSET_MANIFEST.pickups.ENERGY_CRYSTAL.url,
    ...ASSET_MANIFEST.asteroids.LARGE.map((a) => a.url),
    ...ASSET_MANIFEST.asteroids.MEDIUM.map((a) => a.url),
    ...ASSET_MANIFEST.asteroids.SMALL.map((a) => a.url),
  ]
  return [...new Set(urls)]
}
