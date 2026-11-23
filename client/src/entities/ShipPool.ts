import * as THREE from 'three'
import { SHIP_CONFIG, type ShipState } from '@asteroids/shared'
import { centerObjectToOrigin, disposeObjectResources } from '../assets/model-utils'

export const SHIP_CAPACITY = 8

export interface ShipPoolOptions {
  shipTemplate?: THREE.Object3D | null
}

export class ShipPool {
  readonly group: THREE.Group
  private readonly capacity: number
  private mode: 'instanced' | 'template'
  private mesh: THREE.InstancedMesh | null
  private readonly templatePool: THREE.Object3D[] = []
  private readonly scratchMatrix = new THREE.Matrix4()
  private readonly scratchPos = new THREE.Vector3()
  private readonly scratchQuat = new THREE.Quaternion()
  private readonly scratchScale = new THREE.Vector3(1, 1, 1)

  constructor(scene: THREE.Scene, capacity = SHIP_CAPACITY, opts: ShipPoolOptions = {}) {
    this.group = new THREE.Group()
    this.group.name = 'ShipPool'
    scene.add(this.group)

    this.capacity = capacity
    const shipTemplate = opts.shipTemplate ?? null
    if (shipTemplate) {
      this.mode = 'template'
      this.mesh = null
      this.initTemplatePool(shipTemplate, capacity)
    } else {
      this.mode = 'instanced'
      this.mesh = this.initInstancedFallback(capacity)
    }
  }

  setShipTemplate(template: THREE.Object3D | null): void {
    if (this.mode === 'template') {
      this.disposeTemplatePool()
    } else if (this.mesh) {
      this.group.remove(this.mesh)
      this.mesh.geometry.dispose()
      ;(this.mesh.material as THREE.Material).dispose()
      this.mesh = null
    }
    if (template) {
      this.mode = 'template'
      this.initTemplatePool(template, this.capacity)
    } else {
      this.mode = 'instanced'
      this.mesh = this.initInstancedFallback(this.capacity)
    }
  }

  private disposeTemplatePool(): void {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    // Textures are not disposed here: cloned materials share texture references with the
    // original template, so disposing them would break caller-owned template resources.
    for (const obj of this.templatePool) {
      obj.traverse((node) => {
        const mesh = node as THREE.Mesh
        if (!mesh.isMesh) return
        if (mesh.geometry) geometries.add(mesh.geometry)
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => materials.add(m))
        else if (mat) materials.add(mat)
      })
      this.group.remove(obj)
    }
    geometries.forEach((g) => g.dispose())
    materials.forEach((m) => m.dispose())
    this.templatePool.length = 0
  }

  private initInstancedFallback(capacity: number): THREE.InstancedMesh {
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
    const mesh = new THREE.InstancedMesh(geometry, material, capacity)
    mesh.name = 'Ships'
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(mesh)
    return mesh
  }

  private initTemplatePool(template: THREE.Object3D, capacity: number): void {
    for (let i = 0; i < capacity; i++) {
      const clone = template.clone(true)
      clone.visible = false
      clone.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh) return
        mesh.frustumCulled = false
        mesh.geometry = mesh.geometry.clone()
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((m) => m.clone())
        else if (mesh.material) mesh.material = mesh.material.clone()
      })
      centerObjectToOrigin(clone)
      // Bake centering offset into children so runtime position writes on the clone root
      // do not undo the pivot correction.
      const ox = clone.position.x, oy = clone.position.y, oz = clone.position.z
      if (ox !== 0 || oy !== 0 || oz !== 0) {
        for (const child of clone.children) {
          child.position.x += ox
          child.position.y += oy
          child.position.z += oz
        }
        clone.position.set(0, 0, 0)
      }
      this.group.add(clone)
      this.templatePool.push(clone)
    }
    // Pool clones geometry/materials but shares texture references; dispose non-texture resources
    // of the ingested template to avoid leaking the original scene graph.
    disposeObjectResources(template, { textures: false })
  }

  update(ships: readonly ShipState[], localPlayerId: string | null): void {
    if (this.mesh) {
      this.updateInstanced(ships, localPlayerId)
      return
    }
    this.updateTemplate(ships, localPlayerId)
  }

  private updateInstanced(ships: readonly ShipState[], localPlayerId: string | null): void {
    const mesh = this.mesh!
    const capacity = this.capacity
    let count = 0
    for (let i = 0; i < ships.length && count < capacity; i++) {
      const s = ships[i]
      if (s === undefined) continue
      if (localPlayerId !== null && s.id === localPlayerId) continue
      if (!s.alive) continue
      this.scratchPos.set(s.pos[0], s.pos[1], s.pos[2])
      this.scratchQuat.set(s.rot[0], s.rot[1], s.rot[2], s.rot[3])
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale)
      mesh.setMatrixAt(count, this.scratchMatrix)
      count++
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  }

  private updateTemplate(ships: readonly ShipState[], localPlayerId: string | null): void {
    let count = 0
    for (let i = 0; i < ships.length && count < this.capacity; i++) {
      const s = ships[i]
      if (s === undefined) continue
      if (localPlayerId !== null && s.id === localPlayerId) continue
      if (!s.alive) continue
      const obj = this.templatePool[count]!
      obj.position.set(s.pos[0], s.pos[1], s.pos[2])
      obj.quaternion.set(s.rot[0], s.rot[1], s.rot[2], s.rot[3])
      obj.visible = true
      count++
    }
    for (let i = count; i < this.templatePool.length; i++) {
      this.templatePool[i]!.visible = false
    }
  }

  updateWithInterpolation(
    ships: readonly ShipState[],
    localPlayerId: string | null,
    renderTime: number,
    sampleInto: (
      id: string | number,
      serverTime: number,
      out: { pos: [number, number, number]; rot: [number, number, number, number] },
    ) => boolean,
    scratch: { pos: [number, number, number]; rot: [number, number, number, number] },
  ): void {
    if (this.mesh) {
      this.updateInstancedWithInterpolation(ships, localPlayerId, renderTime, sampleInto, scratch)
      return
    }
    this.updateTemplateWithInterpolation(ships, localPlayerId, renderTime, sampleInto, scratch)
  }

  private updateInstancedWithInterpolation(
    ships: readonly ShipState[],
    localPlayerId: string | null,
    renderTime: number,
    sampleInto: (
      id: string | number,
      serverTime: number,
      out: { pos: [number, number, number]; rot: [number, number, number, number] },
    ) => boolean,
    scratch: { pos: [number, number, number]; rot: [number, number, number, number] },
  ): void {
    const mesh = this.mesh!
    let count = 0
    for (let i = 0; i < ships.length && count < this.capacity; i++) {
      const s = ships[i]
      if (s === undefined) continue
      if (localPlayerId !== null && s.id === localPlayerId) continue
      if (!s.alive) continue
      if (sampleInto(s.id, renderTime, scratch)) {
        this.scratchPos.set(scratch.pos[0], scratch.pos[1], scratch.pos[2])
        this.scratchQuat.set(scratch.rot[0], scratch.rot[1], scratch.rot[2], scratch.rot[3])
      } else {
        this.scratchPos.set(s.pos[0], s.pos[1], s.pos[2])
        this.scratchQuat.set(s.rot[0], s.rot[1], s.rot[2], s.rot[3])
      }
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale)
      mesh.setMatrixAt(count, this.scratchMatrix)
      count++
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
  }

  private updateTemplateWithInterpolation(
    ships: readonly ShipState[],
    localPlayerId: string | null,
    renderTime: number,
    sampleInto: (
      id: string | number,
      serverTime: number,
      out: { pos: [number, number, number]; rot: [number, number, number, number] },
    ) => boolean,
    scratch: { pos: [number, number, number]; rot: [number, number, number, number] },
  ): void {
    let count = 0
    for (let i = 0; i < ships.length && count < this.capacity; i++) {
      const s = ships[i]
      if (s === undefined) continue
      if (localPlayerId !== null && s.id === localPlayerId) continue
      if (!s.alive) continue
      const obj = this.templatePool[count]!
      if (sampleInto(s.id, renderTime, scratch)) {
        obj.position.set(scratch.pos[0], scratch.pos[1], scratch.pos[2])
        obj.quaternion.set(scratch.rot[0], scratch.rot[1], scratch.rot[2], scratch.rot[3])
      } else {
        obj.position.set(s.pos[0], s.pos[1], s.pos[2])
        obj.quaternion.set(s.rot[0], s.rot[1], s.rot[2], s.rot[3])
      }
      obj.visible = true
      count++
    }
    for (let i = count; i < this.templatePool.length; i++) {
      this.templatePool[i]!.visible = false
    }
  }

  dispose(): void {
    if (this.mesh) {
      this.group.remove(this.mesh)
      this.mesh.geometry.dispose()
      ;(this.mesh.material as THREE.Material).dispose()
      this.mesh = null
    } else {
      this.disposeTemplatePool()
    }
    this.group.parent?.remove(this.group)
  }
}
