import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { ProjectileState } from '@asteroids/shared'
import { MISSILE_VISUAL_CAPACITY, PROJECTILE_CAPACITY, ProjectilePool } from '../../src/entities/ProjectilePool'

function projectile(overrides: Partial<ProjectileState> & Pick<ProjectileState, 'id' | 'kind' | 'pos'>): ProjectileState {
  return {
    id: overrides.id,
    ownerId: overrides.ownerId ?? 'p1',
    kind: overrides.kind,
    pos: overrides.pos,
    prevPos: overrides.prevPos ?? [overrides.pos[0], overrides.pos[1], overrides.pos[2]],
    vel: overrides.vel ?? [0, 0, -1],
    ttl: overrides.ttl ?? 1,
  }
}

function makeTemplate(): THREE.Group {
  const tpl = new THREE.Group()
  tpl.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
  return tpl
}

function instancedChild(pool: ProjectilePool): THREE.InstancedMesh {
  const mesh = pool.group.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh)
  if (!mesh) throw new Error('instanced mesh not found')
  return mesh as THREE.InstancedMesh
}

function visibleMissileSlots(pool: ProjectilePool): THREE.Object3D[] {
  const instanced = instancedChild(pool)
  return pool.group.children.filter((c) => c !== instanced && c.visible)
}

describe('ProjectilePool', () => {
  it('accepts missile template option', () => {
    const scene = new THREE.Scene()
    const tpl = makeTemplate()
    const pool = new ProjectilePool(scene, 8, { missileTemplate: tpl })
    pool.update([projectile({ id: 1, ownerId: 'p1', kind: 'MISSILE', pos: [0, 0, 0], vel: [0, 0, -1], ttl: 1 })])
    expect(pool.group.children.length).toBeGreaterThan(0)
    pool.dispose()
  })

  it('renders missiles via template slots and keeps non-missiles instanced', () => {
    const scene = new THREE.Scene()
    const pool = new ProjectilePool(scene, 8, { missileTemplate: makeTemplate() })
    pool.update([
      projectile({ id: 1, kind: 'MISSILE', pos: [1, 2, 3], vel: [0, 0, -1] }),
      projectile({ id: 2, kind: 'LASER', pos: [4, 5, 6], vel: [0, 0, -1] }),
    ])

    expect(instancedChild(pool).count).toBe(1)
    const missile = pool.group.children.find(
      (c) => c.visible && c.position.distanceTo(new THREE.Vector3(1, 2, 3)) < 0.001,
    )
    expect(missile).toBeDefined()
    pool.dispose()
  })

  it('falls back to instanced rendering for missiles when no template is provided', () => {
    const scene = new THREE.Scene()
    const pool = new ProjectilePool(scene, 8)
    pool.update([projectile({ id: 1, kind: 'MISSILE', pos: [0, 0, 0], vel: [0, 0, -1] })])
    expect(instancedChild(pool).count).toBe(1)
    pool.dispose()
  })

  it('normalizes missile template to unit radius and keeps -Z forward orientation contract', () => {
    const scene = new THREE.Scene()
    const tpl = new THREE.Group()
    // Off-center, oversized mesh: normalization should center and scale it.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial())
    mesh.position.set(20, 0, 0)
    tpl.add(mesh)
    const pool = new ProjectilePool(scene, 8, { missileTemplate: tpl })

    pool.update([projectile({ id: 1, kind: 'MISSILE', pos: [0, 0, 0], vel: [0, 0, -1] })])
    const slot = visibleMissileSlots(pool)[0]
    expect(slot).toBeDefined()
    // Uniform template scale after normalization (MISSILE_TEMPLATE_SCALE)
    expect(slot!.scale.x).toBeCloseTo(slot!.scale.y)
    expect(slot!.scale.y).toBeCloseTo(slot!.scale.z)

    // Matrix4.lookAt orients local -Z toward target; velocity is -Z, so forward vector should be (0,0,-1).
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(slot!.quaternion)
    expect(forward.x).toBeCloseTo(0, 3)
    expect(forward.y).toBeCloseTo(0, 3)
    expect(forward.z).toBeCloseTo(-1, 3)
    pool.dispose()
  })

  it('falls back overflow missiles to instanced when template slots are exhausted', () => {
    const scene = new THREE.Scene()
    const pool = new ProjectilePool(scene, PROJECTILE_CAPACITY, { missileTemplate: makeTemplate() })
    const missiles = Array.from({ length: MISSILE_VISUAL_CAPACITY + 3 }, (_, i) =>
      projectile({ id: i + 1, kind: 'MISSILE', pos: [i, 0, 0], vel: [0, 0, -1] }),
    )
    pool.update(missiles)

    expect(visibleMissileSlots(pool)).toHaveLength(MISSILE_VISUAL_CAPACITY)
    expect(instancedChild(pool).count).toBe(3)
    pool.dispose()
  })

  it('hides unused missile template slots after missile count drops', () => {
    const scene = new THREE.Scene()
    const pool = new ProjectilePool(scene, 8, { missileTemplate: makeTemplate() })
    pool.update([
      projectile({ id: 1, kind: 'MISSILE', pos: [1, 0, 0], vel: [0, 0, -1] }),
      projectile({ id: 2, kind: 'MISSILE', pos: [2, 0, 0], vel: [0, 0, -1] }),
    ])
    expect(visibleMissileSlots(pool)).toHaveLength(2)

    pool.update([projectile({ id: 1, kind: 'MISSILE', pos: [5, 0, 0], vel: [0, 0, -1] })])
    const visible = visibleMissileSlots(pool)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.position.x).toBeCloseTo(5)
    pool.dispose()
  })

  it('setMissileTemplate replaces and nulls template cleanly', () => {
    const scene = new THREE.Scene()
    const pool = new ProjectilePool(scene, 8)
    pool.update([projectile({ id: 1, kind: 'MISSILE', pos: [0, 0, 0], vel: [0, 0, -1] })])
    expect(instancedChild(pool).count).toBe(1)

    pool.setMissileTemplate(makeTemplate())
    pool.update([projectile({ id: 1, kind: 'MISSILE', pos: [7, 8, 9], vel: [0, 0, -1] })])
    expect(instancedChild(pool).count).toBe(0)
    expect(visibleMissileSlots(pool)).toHaveLength(1)
    expect(visibleMissileSlots(pool)[0]!.position.distanceTo(new THREE.Vector3(7, 8, 9))).toBeLessThan(0.001)

    pool.setMissileTemplate(null)
    pool.update([projectile({ id: 1, kind: 'MISSILE', pos: [0, 0, 0], vel: [0, 0, -1] })])
    expect(instancedChild(pool).count).toBe(1)
    expect(visibleMissileSlots(pool)).toHaveLength(0)
    pool.dispose()
  })

  it('dispose cleans up template missile slots', () => {
    const scene = new THREE.Scene()
    const pool = new ProjectilePool(scene, 8, { missileTemplate: makeTemplate() })
    pool.update([projectile({ id: 1, kind: 'MISSILE', pos: [0, 0, 0], vel: [0, 0, -1] })])
    expect(() => pool.dispose()).not.toThrow()
    expect(pool.group.parent).toBeNull()
  })
})
