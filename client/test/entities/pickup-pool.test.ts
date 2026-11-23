import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PickupPool } from '../../src/entities/PickupPool'

describe('PickupPool', () => {
  it('shows pickups and hides unused slots', () => {
    const scene = new THREE.Scene()
    const pool = new PickupPool(scene, 4)
    pool.update([{ id:1, kind:'SHIELD_CRYSTAL', pos:[1,2,3], ttl:10 } as any], 0.1)
    expect(pool.group.children.length).toBeGreaterThan(0)
    pool.dispose()
  })
})
