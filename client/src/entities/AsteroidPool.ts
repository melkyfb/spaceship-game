import * as THREE from 'three'
import { ASTEROID_TIERS, type AsteroidSize, type AsteroidState } from '@asteroids/shared'

export const ASTEROID_CAPACITY_PER_TIER = 64

export interface AsteroidSyncScratch {
  matrix: THREE.Matrix4
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

export function createAsteroidSyncScratch(): AsteroidSyncScratch {
  return {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  }
}

export function syncAsteroidTier(
  asteroids: readonly AsteroidState[],
  tier: AsteroidSize,
  mesh: THREE.InstancedMesh,
  capacity: number,
  scratch: AsteroidSyncScratch,
): void {
  const radius = ASTEROID_TIERS[tier].radius
  scratch.scale.setScalar(radius)

  let count = 0
  for (let i = 0; i < asteroids.length && count < capacity; i++) {
    const a = asteroids[i]
    if (a === undefined || a.size !== tier) continue
    scratch.position.set(a.pos[0], a.pos[1], a.pos[2])
    scratch.quaternion.set(a.rot[0], a.rot[1], a.rot[2], a.rot[3])
    scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale)
    mesh.setMatrixAt(count, scratch.matrix)
    count++
  }

  mesh.count = count
  mesh.instanceMatrix.needsUpdate = true
}

function createAsteroidMaterial(tier: AsteroidSize): THREE.MeshStandardMaterial {
  // Procedural emissive look per tier, no external assets (ADR-04).
  const color =
    tier === 'LARGE' ? 0x7a6a58 : tier === 'MEDIUM' ? 0x8a7a68 : 0x9a8a78
  const emissive =
    tier === 'LARGE' ? 0x33281f : tier === 'MEDIUM' ? 0x3a2d22 : 0x403328
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.6,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
  })
}

function createAsteroidGeometry(tier: AsteroidSize): THREE.IcosahedronGeometry {
  // Unit geometry; instance scale applies tier radius.
  const detail = tier === 'LARGE' ? 1 : 0
  return new THREE.IcosahedronGeometry(1, detail)
}

export class AsteroidPool {
  readonly group: THREE.Group
  private readonly meshes: Record<AsteroidSize, THREE.InstancedMesh>
  private readonly scratch = createAsteroidSyncScratch()

  constructor(scene: THREE.Scene, capacityPerTier = ASTEROID_CAPACITY_PER_TIER) {
    this.group = new THREE.Group()
    this.group.name = 'AsteroidPool'
    scene.add(this.group)

    const tiers: AsteroidSize[] = ['LARGE', 'MEDIUM', 'SMALL']
    const meshes = {} as Record<AsteroidSize, THREE.InstancedMesh>
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i]!
      const mesh = new THREE.InstancedMesh(
        createAsteroidGeometry(tier),
        createAsteroidMaterial(tier),
        capacityPerTier,
      )
      mesh.name = `Asteroids_${tier}`
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(mesh)
      meshes[tier] = mesh
    }
    this.meshes = meshes
  }

  update(asteroids: readonly AsteroidState[]): void {
    syncAsteroidTier(asteroids, 'LARGE', this.meshes.LARGE, this.meshes.LARGE.instanceMatrix.count, this.scratch)
    syncAsteroidTier(asteroids, 'MEDIUM', this.meshes.MEDIUM, this.meshes.MEDIUM.instanceMatrix.count, this.scratch)
    syncAsteroidTier(asteroids, 'SMALL', this.meshes.SMALL, this.meshes.SMALL.instanceMatrix.count, this.scratch)
  }

  dispose(): void {
    const tiers: AsteroidSize[] = ['LARGE', 'MEDIUM', 'SMALL']
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i]!
      const mesh = this.meshes[tier]
      this.group.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.group.parent?.remove(this.group)
  }
}
