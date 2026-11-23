import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ShipPool } from '../../src/entities/ShipPool'

describe('ShipPool', () => {
  it('uses provided ship template when available', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const pool = new ShipPool(scene, 2, { shipTemplate: tpl })
    pool.update(
      [
        {
          id: 'p2',
          pos: [10, 20, 30],
          vel: [0, 0, 0],
          rot: [0, 0, 0, 1],
          angVel: [0, 0, 0],
          shield: 100,
          energy: 100,
          alive: true,
        } as any,
      ],
      'p1',
    )

    // Template mode should place a visible cloned object at the ship position.
    const positioned = pool.group.children.find(
      (c) => c.visible && c.position.distanceTo(new THREE.Vector3(10, 20, 30)) < 0.001,
    )
    expect(positioned).toBeDefined()
  })

  it('keeps instanced fallback when no template is provided', () => {
    const scene = new THREE.Scene()
    const pool = new ShipPool(scene, 2)
    pool.update(
      [
        {
          id: 'p2',
          pos: [1, 2, 3],
          vel: [0, 0, 0],
          rot: [0, 0, 0, 1],
          angVel: [0, 0, 0],
          shield: 100,
          energy: 100,
          alive: true,
        } as any,
      ],
      'p1',
    )
    const instanced = pool.group.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as
      | THREE.InstancedMesh
      | undefined
    expect(instanced).toBeDefined()
    expect(instanced?.count).toBe(1)
  })

  it('positions template clones with interpolation', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const pool = new ShipPool(scene, 2, { shipTemplate: tpl })
    pool.updateWithInterpolation(
      [
        {
          id: 'p2',
          pos: [0, 0, 0],
          vel: [0, 0, 0],
          rot: [0, 0, 0, 1],
          angVel: [0, 0, 0],
          shield: 100,
          energy: 100,
          alive: true,
        } as any,
      ],
      'p1',
      100,
      () => true,
      { pos: [5, 6, 7], rot: [0, 0, 0, 1] },
    )
    const positioned = pool.group.children.find(
      (c) => c.visible && c.position.distanceTo(new THREE.Vector3(5, 6, 7)) < 0.001,
    )
    expect(positioned).toBeDefined()
  })
})
