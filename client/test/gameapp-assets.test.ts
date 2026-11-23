import { describe, expect, it } from 'vitest'
import { getP1AssetUrls } from '../src/assets/manifest'

it('preload list includes all P1 runtime assets', () => {
  expect(getP1AssetUrls()).toEqual(expect.arrayContaining([
    '/assets/models/ships/player_ship.glb',
    '/assets/models/projectiles/missile.glb',
  ]))
})
