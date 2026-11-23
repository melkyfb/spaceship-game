import * as THREE from 'three'
import { SHIP_CONFIG, type ShipState } from '@asteroids/shared'

export const SHIP_CAPACITY = 8

export class ShipPool {
  readonly group: THREE.Group
  private readonly mesh: THREE.InstancedMesh
  private readonly scratchMatrix = new THREE.Matrix4()
  private readonly scratchPos = new THREE.Vector3()
  private readonly scratchQuat = new THREE.Quaternion()
  private readonly scratchScale = new THREE.Vector3(1, 1, 1)

  constructor(scene: THREE.Scene, capacity = SHIP_CAPACITY) {
    this.group = new THREE.Group()
    this.group.name = 'ShipPool'
    scene.add(this.group)

    const geometry = new THREE.ConeGeometry(SHIP_CONFIG.RADIUS * 0.7, SHIP_CONFIG.RADIUS * 2.2, 6)
    geometry.rotateX(Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({
      color: 0x66ccff,
      emissive: 0x113344,
      emissiveIntensity: 0.8,
      roughness: 0.4,
      metalness: 0.3,
      flatShading: true,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.name = 'Ships'
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.mesh)
  }

  update(ships: readonly ShipState[], localPlayerId: string | null): void {
    const capacity = this.mesh.instanceMatrix.count
    let count = 0
    for (let i = 0; i < ships.length && count < capacity; i++) {
      const s = ships[i]
      if (s === undefined) continue
      if (localPlayerId !== null && s.id === localPlayerId) continue
      if (!s.alive) continue
      this.scratchPos.set(s.pos[0], s.pos[1], s.pos[2])
      this.scratchQuat.set(s.rot[0], s.rot[1], s.rot[2], s.rot[3])
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
