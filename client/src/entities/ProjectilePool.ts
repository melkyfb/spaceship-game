import * as THREE from 'three'
import type { ProjectileState } from '@asteroids/shared'
import { disposeObjectResources, normalizeObjectToRadius } from '../assets/model-utils'

export const PROJECTILE_CAPACITY = 256
export const MISSILE_VISUAL_CAPACITY = 32
/**
 * Missile GLB template contract:
 * - Authored forward: -Z, up: +Y, origin at gameplay center.
 * - Template is centered and normalized to unit bounding-sphere radius on ingestion.
 * - Slot group is scaled uniformly by MISSILE_TEMPLATE_SCALE so authored size does not leak.
 * - Runtime orientation points local -Z along projectile velocity (gameplay forward: -Z).
 */
export const MISSILE_TEMPLATE_SCALE = 1.4

const UP = new THREE.Vector3(0, 1, 0)

export interface ProjectilePoolOptions {
  missileTemplate?: THREE.Object3D | null
}

interface MissileSlot {
  group: THREE.Group
  visual: THREE.Object3D
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

export class ProjectilePool {
  readonly group: THREE.Group
  private readonly mesh: THREE.InstancedMesh
  private readonly scratchMatrix = new THREE.Matrix4()
  private readonly scratchPos = new THREE.Vector3()
  private readonly scratchQuat = new THREE.Quaternion()
  private readonly scratchScale = new THREE.Vector3(0.35, 0.35, 1.8)
  private readonly scratchDir = new THREE.Vector3()
  private readonly scratchTarget = new THREE.Vector3()
  private readonly scratchLook = new THREE.Matrix4()
  private missileSlots: MissileSlot[] = []

  constructor(scene: THREE.Scene, capacity = PROJECTILE_CAPACITY, opts: ProjectilePoolOptions = {}) {
    this.group = new THREE.Group()
    this.group.name = 'ProjectilePool'
    scene.add(this.group)

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial({
      color: 0x9ffcff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.name = 'Projectiles'
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.mesh)

    if (opts.missileTemplate) {
      this.setMissileTemplate(opts.missileTemplate)
    }
  }

  setMissileTemplate(template: THREE.Object3D | null): void {
    for (let i = 0; i < this.missileSlots.length; i++) {
      const slot = this.missileSlots[i]!
      disposeObjectResources(slot.visual, { textures: false })
      this.group.remove(slot.group)
    }
    this.missileSlots = []

    if (!template) return

    for (let i = 0; i < MISSILE_VISUAL_CAPACITY; i++) {
      const group = new THREE.Group()
      group.name = `Missile_${i}`
      group.visible = false
      const visual = cloneTemplateObject(template)
      normalizeObjectToRadius(visual, 1)
      group.add(visual)
      this.group.add(group)
      this.missileSlots.push({ group, visual })
    }
    // Clones own geometry/materials; textures are shared refs, so dispose non-texture resources only.
    disposeObjectResources(template, { textures: false })
  }

  update(projectiles: readonly ProjectileState[]): void {
    const instancedCapacity = this.mesh.instanceMatrix.count
    let instancedCount = 0
    let missileCount = 0
    const useMissileTemplate = this.missileSlots.length > 0

    for (let i = 0; i < projectiles.length; i++) {
      const p = projectiles[i]
      if (p === undefined) continue

      const isMissile = p.kind === 'MISSILE'
      if (isMissile && useMissileTemplate) {
        if (missileCount >= this.missileSlots.length) {
          // Overflow missiles fall back to instanced rendering.
          if (instancedCount >= instancedCapacity) continue
          this.writeInstanced(p, instancedCount++)
          continue
        }
        this.writeMissileSlot(p, this.missileSlots[missileCount]!)
        missileCount++
        continue
      }

      if (instancedCount >= instancedCapacity) continue
      this.writeInstanced(p, instancedCount++)
    }

    this.mesh.count = instancedCount
    this.mesh.instanceMatrix.needsUpdate = true

    for (let i = missileCount; i < this.missileSlots.length; i++) {
      this.missileSlots[i]!.group.visible = false
    }
  }

  private writeMissileSlot(p: ProjectileState, slot: MissileSlot): void {
    this.scratchPos.set(p.pos[0], p.pos[1], p.pos[2])
    this.writeOrientation(p)
    slot.group.position.copy(this.scratchPos)
    slot.group.quaternion.copy(this.scratchQuat)
    slot.group.scale.setScalar(MISSILE_TEMPLATE_SCALE)
    slot.group.visible = true
  }

  private writeInstanced(p: ProjectileState, index: number): void {
    this.scratchPos.set(p.pos[0], p.pos[1], p.pos[2])
    this.writeOrientation(p)

    const scaleZ = p.kind === 'MISSILE' ? 2.8 : p.kind === 'ENEMY_PLASMA' ? 1.4 : 1.8
    const scaleXY = p.kind === 'MISSILE' ? 0.45 : p.kind === 'ENEMY_PLASMA' ? 0.5 : 0.35
    this.scratchScale.set(scaleXY, scaleXY, scaleZ)

    this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale)
    this.mesh.setMatrixAt(index, this.scratchMatrix)
  }

  private writeOrientation(p: ProjectileState): void {
    const vx = p.vel[0]
    const vy = p.vel[1]
    const vz = p.vel[2]
    const len = Math.hypot(vx, vy, vz)
    if (len > 1e-6) {
      this.scratchDir.set(vx / len, vy / len, vz / len)
      // Orient local -Z along velocity (Three.js lookAt convention).
      // Missile/ship templates are authored with forward -Z, so this matches gameplay forward -Z.
      this.scratchTarget.set(
        this.scratchPos.x + this.scratchDir.x,
        this.scratchPos.y + this.scratchDir.y,
        this.scratchPos.z + this.scratchDir.z,
      )
      this.scratchLook.lookAt(this.scratchPos, this.scratchTarget, UP)
      this.scratchQuat.setFromRotationMatrix(this.scratchLook)
    } else {
      this.scratchQuat.identity()
    }
  }

  dispose(): void {
    this.setMissileTemplate(null)
    this.group.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.group.parent?.remove(this.group)
  }
}
