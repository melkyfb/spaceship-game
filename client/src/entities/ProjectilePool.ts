import * as THREE from 'three'
import type { ProjectileState } from '@asteroids/shared'

export const PROJECTILE_CAPACITY = 256

const UP = new THREE.Vector3(0, 1, 0)

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

  constructor(scene: THREE.Scene, capacity = PROJECTILE_CAPACITY) {
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
  }

  update(projectiles: readonly ProjectileState[]): void {
    const capacity = this.mesh.instanceMatrix.count
    let count = 0

    for (let i = 0; i < projectiles.length && count < capacity; i++) {
      const p = projectiles[i]
      if (p === undefined) continue

      this.scratchPos.set(p.pos[0], p.pos[1], p.pos[2])

      const vx = p.vel[0]
      const vy = p.vel[1]
      const vz = p.vel[2]
      const len = Math.hypot(vx, vy, vz)
      if (len > 1e-6) {
        this.scratchDir.set(vx / len, vy / len, vz / len)
        // Orient +Z along velocity.
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

      const scaleZ = p.kind === 'MISSILE' ? 2.8 : p.kind === 'ENEMY_PLASMA' ? 1.4 : 1.8
      const scaleXY = p.kind === 'MISSILE' ? 0.45 : p.kind === 'ENEMY_PLASMA' ? 0.5 : 0.35
      this.scratchScale.set(scaleXY, scaleXY, scaleZ)

      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale)
      this.mesh.setMatrixAt(count, this.scratchMatrix)
      count++
    }

    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.group.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.group.parent?.remove(this.group)
  }
}
