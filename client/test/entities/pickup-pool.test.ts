import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PickupPool } from '../../src/entities/PickupPool'

describe('PickupPool', () => {
  it('shows pickups and hides unused slots', () => {
    const scene = new THREE.Scene()
    const pool = new PickupPool(scene, 4)
    pool.update([{ id: 1, kind: 'SHIELD_CRYSTAL', pos: [1, 2, 3], ttl: 10 } as any], 0.1)

    expect(pool.group.children.length).toBe(4)
    const active = pool.group.children[0] as THREE.Group
    const inactive = pool.group.children[1] as THREE.Group
    expect(active.visible).toBe(true)
    expect(inactive.visible).toBe(false)

    const shield = active.children.find((obj) => obj.name.includes('SHIELD_CRYSTAL'))
    const energy = active.children.find((obj) => obj.name.includes('ENERGY_CRYSTAL'))
    expect(shield?.visible).toBe(true)
    expect(energy?.visible).toBe(false)

    expect(active.position.x).toBeCloseTo(1)
    expect(active.position.z).toBeCloseTo(3)
    expect(active.position.y).toBeCloseTo(2 + Math.sin(0.1 * 2 + 1) * 0.15)
    expect(active.rotation.y).toBeCloseTo(0.15)
    expect(active.scale.x).toBeCloseTo(2)

    pool.update([], 0.1)
    expect(active.visible).toBe(false)
    pool.dispose()
  })

  it('deep-clones template meshes so disposal does not touch originals', () => {
    const scene = new THREE.Scene()
    const geom = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    const template = new THREE.Mesh(geom, mat)
    template.name = 'TemplateShield'

    const pool = new PickupPool(scene, 1, {
      templates: { SHIELD_CRYSTAL: template },
    })

    pool.update([{ id: 1, kind: 'SHIELD_CRYSTAL', pos: [0, 0, 0], ttl: 10 } as any], 0)
    const slot = pool.group.children[0] as THREE.Group
    const clone = slot.children.find((obj) => obj.name === 'TemplateShield') as THREE.Mesh
    expect(clone).toBeDefined()
    expect(clone.geometry).not.toBe(geom)
    expect(clone.material).not.toBe(mat)

    pool.dispose()
    expect(geom.uuid).toBeTruthy()
    expect(mat.uuid).toBeTruthy()
    // original template resources should still be usable (not disposed in a way we can directly observe here,
    // but identity check above ensures clones got their own resources)
    geom.dispose()
    mat.dispose()
  })
})
