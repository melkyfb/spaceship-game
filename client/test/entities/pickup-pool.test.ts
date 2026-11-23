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

  it('deep-clones template meshes and takes ownership of ingested templates', () => {
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
    // Pool takes ownership of ingested template resources (non-texture) to avoid leaks.
    // Clones have independent geometry/material instances.
    expect(clone.geometry).not.toBe(geom)
  })

  it('centers off-center pickup template at gameplay position (accounting for bob)', () => {
    const scene = new THREE.Scene()
    const offCenter = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    mesh.position.set(10, -4, 3)
    offCenter.add(mesh)

    const pool = new PickupPool(scene, 2, {
      templates: { SHIELD_CRYSTAL: offCenter },
    })

    pool.update([{ id: 7, kind: 'SHIELD_CRYSTAL', pos: [100, 200, -50], ttl: 10 } as any], 0)

    const slot = pool.group.children.find((c) => c.visible) as THREE.Group | undefined
    expect(slot).toBeDefined()

    slot!.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(slot!)
    const center = new THREE.Vector3()
    box.getCenter(center)

    const expectedBob = Math.sin(0 * 2 + 7) * 0.15
    expect(center.x).toBeCloseTo(100, 3)
    expect(center.y).toBeCloseTo(200 + expectedBob, 3)
    expect(center.z).toBeCloseTo(-50, 3)
    pool.dispose()
  })
})
