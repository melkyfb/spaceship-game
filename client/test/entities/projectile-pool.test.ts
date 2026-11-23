import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ProjectilePool } from '../../src/entities/ProjectilePool'

describe('ProjectilePool', () => {
  it('accepts missile template option', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const pool = new ProjectilePool(scene, 8, { missileTemplate: tpl })
    pool.update([
      { id: 1, ownerId: 'p1', kind: 'MISSILE', pos: [0, 0, 0], prevPos: [0, 0, 0], vel: [0, 0, -1], ttl: 1 } as any,
    ])
    expect(pool.group.children.length).toBeGreaterThan(0)
    pool.dispose()
  })

  it('renders missiles via template slots and keeps non-missiles instanced', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const pool = new ProjectilePool(scene, 8, { missileTemplate: tpl })
    pool.update([
      { id: 1, ownerId: 'p1', kind: 'MISSILE', pos: [1, 2, 3], prevPos: [0, 0, 0], vel: [0, 0, -1], ttl: 1 } as any,
      { id: 2, ownerId: 'p1', kind: 'LASER', pos: [4, 5, 6], prevPos: [0, 0, 0], vel: [0, 0, -1], ttl: 1 } as any,
    ])

    const instanced = pool.group.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as
      | THREE.InstancedMesh
      | undefined
    expect(instanced).toBeDefined()
    expect(instanced?.count).toBe(1)

    const missile = pool.group.children.find(
      (c) => c.visible && c.position.distanceTo(new THREE.Vector3(1, 2, 3)) < 0.001,
    )
    expect(missile).toBeDefined()
    pool.dispose()
  })

  it('falls back to instanced rendering for missiles when no template is provided', () => {
    const scene = new THREE.Scene()
    const pool = new ProjectilePool(scene, 8)
    pool.update([
      { id: 1, ownerId: 'p1', kind: 'MISSILE', pos: [0, 0, 0], prevPos: [0, 0, 0], vel: [0, 0, -1], ttl: 1 } as any,
    ])
    const instanced = pool.group.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as
      | THREE.InstancedMesh
      | undefined
    expect(instanced).toBeDefined()
    expect(instanced?.count).toBe(1)
    pool.dispose()
  })

  it('dispose cleans up template missile slots', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
    const pool = new ProjectilePool(scene, 8, { missileTemplate: tpl })
    pool.update([
      { id: 1, ownerId: 'p1', kind: 'MISSILE', pos: [0, 0, 0], prevPos: [0, 0, 0], vel: [0, 0, -1], ttl: 1 } as any,
    ])
    expect(() => pool.dispose()).not.toThrow()
    expect(pool.group.parent).toBeNull()
  })
})
