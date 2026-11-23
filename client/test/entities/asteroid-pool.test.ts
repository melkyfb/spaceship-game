import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { AsteroidState } from '@asteroids/shared'
import { ASTEROID_CAPACITY_PER_TIER, syncAsteroidTier } from '../../src/entities/AsteroidPool'

function makeAsteroid(id: number, x: number, y: number, z: number, size: AsteroidState['size'] = 'LARGE'): AsteroidState {
  return {
    id,
    pos: [x, y, z],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    size,
    hp: 10,
  }
}

describe('syncAsteroidTier', () => {
  it('writes matrices and count for matching asteroids without allocating new scratch objects', () => {
    const capacity = 4
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      capacity,
    )
    const scratch = {
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    }

    const asteroids: AsteroidState[] = [
      makeAsteroid(1, 10, 2, -3, 'LARGE'),
      makeAsteroid(2, -4, 5, 6, 'MEDIUM'),
      makeAsteroid(3, 7, 8, 9, 'LARGE'),
    ]

    const matrixRef = scratch.matrix
    const posRef = scratch.position
    const quatRef = scratch.quaternion
    const scaleRef = scratch.scale
    const instanceArrayBefore = mesh.instanceMatrix.array

    syncAsteroidTier(asteroids, 'LARGE', mesh, capacity, scratch)

    expect(mesh.count).toBe(2)
    expect(scratch.matrix).toBe(matrixRef)
    expect(scratch.position).toBe(posRef)
    expect(scratch.quaternion).toBe(quatRef)
    expect(scratch.scale).toBe(scaleRef)
    expect(mesh.instanceMatrix.array).toBe(instanceArrayBefore)

    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()

    mesh.getMatrixAt(0, m)
    m.decompose(p, q, s)
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(2)
    expect(p.z).toBeCloseTo(-3)
    expect(q.x).toBeCloseTo(0)
    expect(q.y).toBeCloseTo(0)
    expect(q.z).toBeCloseTo(0)
    expect(q.w).toBeCloseTo(1)

    mesh.getMatrixAt(1, m)
    m.decompose(p, q, s)
    expect(p.x).toBeCloseTo(7)
    expect(p.y).toBeCloseTo(8)
    expect(p.z).toBeCloseTo(9)
  })

  it('caps count to capacity and updates instanceMatrix', () => {
    const capacity = 2
    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial(),
      capacity,
    )
    const scratch = {
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
    }

    const asteroids: AsteroidState[] = [
      makeAsteroid(1, 1, 0, 0, 'SMALL'),
      makeAsteroid(2, 2, 0, 0, 'SMALL'),
      makeAsteroid(3, 3, 0, 0, 'SMALL'),
    ]

    syncAsteroidTier(asteroids, 'SMALL', mesh, capacity, scratch)

    expect(mesh.count).toBe(2)
    expect(mesh.instanceMatrix.version).toBeGreaterThan(0)
  })

  it('exports per-tier capacity constant', () => {
    expect(ASTEROID_CAPACITY_PER_TIER).toBeGreaterThan(0)
  })
})
