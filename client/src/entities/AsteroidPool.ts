import * as THREE from 'three'
import { ASTEROID_TIERS, type AsteroidSize, type AsteroidState } from '@asteroids/shared'

export const ASTEROID_CAPACITY_PER_TIER = 64

export interface AsteroidPoolOptions {
  templatesByTier?: Partial<Record<AsteroidSize, THREE.Object3D[]>>
}

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

export function pickAsteroidVariantIndex(id: number, variantCount: number): number {
  if (variantCount <= 0) return 0
  const x = Math.abs(id | 0)
  return x % variantCount
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

interface AsteroidTemplateSlot {
  group: THREE.Group
  variants: THREE.Object3D[]
}

interface AsteroidTierState {
  mode: 'instanced' | 'template'
  mesh: THREE.InstancedMesh | null
  slots: AsteroidTemplateSlot[]
  capacity: number
}

function normalizeTemplateToUnit(obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj)
  const sphere = new THREE.Sphere()
  box.getBoundingSphere(sphere)
  const r = sphere.radius
  if (r > 1e-6) obj.scale.multiplyScalar(1 / r)
}

function cloneTemplateObject(template: THREE.Object3D): THREE.Object3D {
  const clone = template.clone(true)
  clone.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.frustumCulled = false
    mesh.geometry = mesh.geometry.clone()
    if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone())
    else if (mesh.material) mesh.material = mesh.material.clone()
  })
  return clone
}

function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}

export class AsteroidPool {
  readonly group: THREE.Group
  private readonly tiers: Record<AsteroidSize, AsteroidTierState>
  private readonly scratch = createAsteroidSyncScratch()

  constructor(scene: THREE.Scene, capacityPerTier = ASTEROID_CAPACITY_PER_TIER, opts: AsteroidPoolOptions = {}) {
    this.group = new THREE.Group()
    this.group.name = 'AsteroidPool'
    scene.add(this.group)

    const tierNames: AsteroidSize[] = ['LARGE', 'MEDIUM', 'SMALL']
    const tiers = {} as Record<AsteroidSize, AsteroidTierState>
    for (let i = 0; i < tierNames.length; i++) {
      const tier = tierNames[i]!
      const templates = opts.templatesByTier?.[tier]
      if (templates && templates.length > 0) {
        tiers[tier] = this.initTemplateTier(tier, templates, capacityPerTier)
      } else {
        tiers[tier] = this.initInstancedTier(tier, capacityPerTier)
      }
    }
    this.tiers = tiers
  }

  private initInstancedTier(tier: AsteroidSize, capacity: number): AsteroidTierState {
    const mesh = new THREE.InstancedMesh(
      createAsteroidGeometry(tier),
      createAsteroidMaterial(tier),
      capacity,
    )
    mesh.name = `Asteroids_${tier}`
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(mesh)
    return { mode: 'instanced', mesh, slots: [], capacity }
  }

  private initTemplateTier(tier: AsteroidSize, templates: THREE.Object3D[], capacity: number): AsteroidTierState {
    const slots: AsteroidTemplateSlot[] = []
    for (let i = 0; i < capacity; i++) {
      const group = new THREE.Group()
      group.name = `Asteroid_${tier}_${i}`
      group.visible = false
      const variants: THREE.Object3D[] = []
      for (let v = 0; v < templates.length; v++) {
        const clone = cloneTemplateObject(templates[v]!)
        normalizeTemplateToUnit(clone)
        clone.visible = false
        group.add(clone)
        variants.push(clone)
      }
      this.group.add(group)
      slots.push({ group, variants })
    }
    return { mode: 'template', mesh: null, slots, capacity }
  }

  update(asteroids: readonly AsteroidState[]): void {
    this.updateTier('LARGE', asteroids)
    this.updateTier('MEDIUM', asteroids)
    this.updateTier('SMALL', asteroids)
  }

  private updateTier(tier: AsteroidSize, asteroids: readonly AsteroidState[]): void {
    const state = this.tiers[tier]
    if (state.mode === 'instanced' && state.mesh) {
      syncAsteroidTier(asteroids, tier, state.mesh, state.capacity, this.scratch)
      return
    }
    this.updateTemplateTier(tier, asteroids, state)
  }

  private updateTemplateTier(tier: AsteroidSize, asteroids: readonly AsteroidState[], state: AsteroidTierState): void {
    const radius = ASTEROID_TIERS[tier].radius
    const slots = state.slots
    const capacity = state.capacity
    let count = 0
    for (let i = 0; i < asteroids.length && count < capacity; i++) {
      const a = asteroids[i]
      if (a === undefined || a.size !== tier) continue
      const slot = slots[count]!
      const variantIdx = pickAsteroidVariantIndex(a.id, slot.variants.length)
      slot.group.position.set(a.pos[0], a.pos[1], a.pos[2])
      slot.group.quaternion.set(a.rot[0], a.rot[1], a.rot[2], a.rot[3])
      slot.group.scale.setScalar(radius)
      for (let v = 0; v < slot.variants.length; v++) {
        slot.variants[v]!.visible = v === variantIdx
      }
      slot.group.visible = true
      count++
    }
    for (let i = count; i < slots.length; i++) {
      slots[i]!.group.visible = false
    }
  }

  dispose(): void {
    const tierNames: AsteroidSize[] = ['LARGE', 'MEDIUM', 'SMALL']
    for (let i = 0; i < tierNames.length; i++) {
      const tier = tierNames[i]!
      const state = this.tiers[tier]
      if (state.mode === 'instanced' && state.mesh) {
        this.group.remove(state.mesh)
        state.mesh.geometry.dispose()
        ;(state.mesh.material as THREE.Material).dispose()
        state.mesh = null
      } else {
        for (let s = 0; s < state.slots.length; s++) {
          const slot = state.slots[s]!
          for (let v = 0; v < slot.variants.length; v++) {
            disposeObject3D(slot.variants[v]!)
          }
          this.group.remove(slot.group)
        }
        state.slots.length = 0
      }
    }
    this.group.parent?.remove(this.group)
  }
}
