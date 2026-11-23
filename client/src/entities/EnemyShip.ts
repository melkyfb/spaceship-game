import * as THREE from 'three'
import { ENEMY_ARCHETYPES, type EnemyArchetype, type EnemyState } from '@asteroids/shared'

export const ENEMY_CAPACITY_PER_ARCHETYPE = 32

export interface EnemySyncScratch {
  matrix: THREE.Matrix4
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

function createEnemyGeometry(archetype: EnemyArchetype): THREE.BufferGeometry {
  // Minimal procedural shapes, no external assets (ADR-04).
  if (archetype === 'SCOUT') {
    return new THREE.OctahedronGeometry(1, 0)
  }
  if (archetype === 'BRUISER') {
    return new THREE.BoxGeometry(1.4, 0.8, 1.8)
  }
  return new THREE.TetrahedronGeometry(1, 0)
}

function createEnemyMaterial(archetype: EnemyArchetype): THREE.MeshStandardMaterial {
  const color =
    archetype === 'SCOUT' ? 0xff5b5b : archetype === 'BRUISER' ? 0xff9440 : 0x7cff8a
  const emissive =
    archetype === 'SCOUT' ? 0x551111 : archetype === 'BRUISER' ? 0x552200 : 0x114411
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.9,
    roughness: 0.45,
    metalness: 0.2,
    flatShading: true,
  })
}

function enemyRadius(archetype: EnemyArchetype): number {
  if (archetype === 'BRUISER') return 5
  if (archetype === 'SCAVENGER') return 3.5
  return 3
}

export class EnemyPool {
  readonly group: THREE.Group
  private readonly meshes: Record<EnemyArchetype, THREE.InstancedMesh>
  private readonly scratch: EnemySyncScratch = {
    matrix: new THREE.Matrix4(),
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  }

  constructor(scene: THREE.Scene, capacityPerArchetype = ENEMY_CAPACITY_PER_ARCHETYPE) {
    this.group = new THREE.Group()
    this.group.name = 'EnemyPool'
    scene.add(this.group)

    const archetypes: EnemyArchetype[] = ['SCOUT', 'BRUISER', 'SCAVENGER']
    const meshes = {} as Record<EnemyArchetype, THREE.InstancedMesh>

    for (let i = 0; i < archetypes.length; i++) {
      const archetype = archetypes[i]!
      const mesh = new THREE.InstancedMesh(
        createEnemyGeometry(archetype),
        createEnemyMaterial(archetype),
        capacityPerArchetype,
      )
      mesh.name = `Enemies_${archetype}`
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(mesh)
      meshes[archetype] = mesh
    }

    this.meshes = meshes
  }

  update(enemies: readonly EnemyState[]): void {
    this.syncArchetype('SCOUT', enemies)
    this.syncArchetype('BRUISER', enemies)
    this.syncArchetype('SCAVENGER', enemies)
  }

  private syncArchetype(archetype: EnemyArchetype, enemies: readonly EnemyState[]): void {
    const mesh = this.meshes[archetype]
    const capacity = mesh.instanceMatrix.count
    const radius = enemyRadius(archetype)
    this.scratch.scale.setScalar(radius)

    let count = 0
    for (let i = 0; i < enemies.length && count < capacity; i++) {
      const e = enemies[i]
      if (e === undefined || e.archetype !== archetype) continue
      this.scratch.position.set(e.pos[0], e.pos[1], e.pos[2])
      this.scratch.quaternion.set(e.rot[0], e.rot[1], e.rot[2], e.rot[3])
      this.scratch.matrix.compose(this.scratch.position, this.scratch.quaternion, this.scratch.scale)
      mesh.setMatrixAt(count, this.scratch.matrix)
      count++
    }

    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    const archetypes: EnemyArchetype[] = ['SCOUT', 'BRUISER', 'SCAVENGER']
    for (let i = 0; i < archetypes.length; i++) {
      const archetype = archetypes[i]!
      const mesh = this.meshes[archetype]
      this.group.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.group.parent?.remove(this.group)
  }
}
