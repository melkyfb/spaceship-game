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

  it('skips local player and dead ships in template mode', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const pool = new ShipPool(scene, 4, { shipTemplate: tpl })
    pool.update(
      [
        { id: 'local', pos: [1, 0, 0], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], shield: 100, energy: 100, alive: true } as any,
        { id: 'dead', pos: [2, 0, 0], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], shield: 0, energy: 0, alive: false } as any,
        { id: 'remote', pos: [3, 0, 0], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], shield: 100, energy: 100, alive: true } as any,
      ],
      'local',
    )
    const visible = pool.group.children.filter((c) => c.visible)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.position.distanceTo(new THREE.Vector3(3, 0, 0))).toBeLessThan(0.001)
  })

  it('hides unused template clones across updates', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const pool = new ShipPool(scene, 4, { shipTemplate: tpl })
    const ship = (id: string, x: number) =>
      ({ id, pos: [x, 0, 0], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], shield: 100, energy: 100, alive: true }) as any
    pool.update([ship('a', 1), ship('b', 2)], null)
    expect(pool.group.children.filter((c) => c.visible)).toHaveLength(2)
    pool.update([ship('a', 5)], null)
    const visible = pool.group.children.filter((c) => c.visible)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.position.x).toBeCloseTo(5)
  })

  it('setShipTemplate switches modes cleanly', () => {
    const scene = new THREE.Scene()
    const pool = new ShipPool(scene, 2)
    const ship = { id: 'p2', pos: [7, 8, 9], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], shield: 100, energy: 100, alive: true } as any

    pool.update([ship], 'p1')
    const instanced = pool.group.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh
    expect(instanced.count).toBe(1)

    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    pool.setShipTemplate(tpl)
    pool.update([ship], 'p1')
    expect(pool.group.children.some((c) => (c as THREE.InstancedMesh).isInstancedMesh)).toBe(false)
    expect(pool.group.children.filter((c) => c.visible && c.position.distanceTo(new THREE.Vector3(7, 8, 9)) < 0.001)).toHaveLength(1)

    pool.setShipTemplate(null)
    pool.update([ship], 'p1')
    const instanced2 = pool.group.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh
    expect(instanced2).toBeDefined()
    expect(instanced2.count).toBe(1)
  })

  it('dispose removes group and cleans up safely', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    const geom = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshBasicMaterial()
    tpl.add(new THREE.Mesh(geom, mat))
    const pool = new ShipPool(scene, 2, { shipTemplate: tpl })
    pool.update([{ id: 'p2', pos: [0, 0, 0], vel: [0, 0, 0], rot: [0, 0, 0, 1], angVel: [0, 0, 0], shield: 100, energy: 100, alive: true } as any], 'p1')

    expect(scene.children).toContain(pool.group)
    expect(() => pool.dispose()).not.toThrow()
    expect(pool.group.parent).toBeNull()
    expect(scene.children).not.toContain(pool.group)
  })
})
