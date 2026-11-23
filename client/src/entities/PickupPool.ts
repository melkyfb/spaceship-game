import * as THREE from 'three'
import type { PickupState } from '@asteroids/shared'
import { normalizeObjectToRadius } from '../assets/model-utils'

export type PickupKind = 'SHIELD_CRYSTAL' | 'ENERGY_CRYSTAL'

export interface PickupPoolOptions {
  templates?: Partial<Record<PickupKind, THREE.Object3D>>
}

interface PickupSlot {
  group: THREE.Group
  byKind: Record<PickupKind, THREE.Object3D>
}

const PICKUP_KINDS: PickupKind[] = ['SHIELD_CRYSTAL', 'ENERGY_CRYSTAL']
const PICKUP_VISUAL_RADIUS = 2.0

function createFallbackObject(kind: PickupKind): THREE.Mesh {
  const geometry =
    kind === 'SHIELD_CRYSTAL' ? new THREE.IcosahedronGeometry(1, 0) : new THREE.OctahedronGeometry(1, 0)
  const color = kind === 'SHIELD_CRYSTAL' ? 0x66ccff : 0xffcc44
  const emissive = kind === 'SHIELD_CRYSTAL' ? 0x1a4466 : 0x664400
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 1.2,
    roughness: 0.25,
    metalness: 0.1,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `PickupFallback_${kind}`
  return mesh
}

function cloneTemplateObject(template: THREE.Object3D): THREE.Object3D {
  const clone = template.clone(true)
  clone.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.frustumCulled = false
    mesh.geometry = mesh.geometry.clone()
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone())
    } else if (mesh.material) {
      mesh.material = mesh.material.clone()
    }
  })
  normalizeObjectToRadius(clone, 1)
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

export class PickupPool {
  readonly group: THREE.Group
  private readonly slots: PickupSlot[] = []
  private readonly capacity: number
  private time = 0

  constructor(scene: THREE.Scene, capacity = 32, opts: PickupPoolOptions = {}) {
    this.capacity = Math.max(0, capacity | 0)
    this.group = new THREE.Group()
    this.group.name = 'PickupPool'
    scene.add(this.group)

    for (let i = 0; i < this.capacity; i++) {
      const group = new THREE.Group()
      group.name = `PickupSlot_${i}`
      group.visible = false
      group.scale.setScalar(PICKUP_VISUAL_RADIUS)

      const byKind = {} as Record<PickupKind, THREE.Object3D>
      for (let k = 0; k < PICKUP_KINDS.length; k++) {
        const kind = PICKUP_KINDS[k]!
        const template = opts.templates?.[kind]
        const obj = template ? cloneTemplateObject(template) : createFallbackObject(kind)
        obj.visible = false
        group.add(obj)
        byKind[kind] = obj
      }

      this.group.add(group)
      this.slots.push({ group, byKind })
    }
  }

  setPickupTemplates(templates: Partial<Record<PickupKind, THREE.Object3D>>): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!
      for (let k = 0; k < PICKUP_KINDS.length; k++) {
        disposeObject3D(slot.byKind[PICKUP_KINDS[k]!])
      }
      this.group.remove(slot.group)
    }
    this.slots.length = 0

    for (let i = 0; i < this.capacity; i++) {
      const group = new THREE.Group()
      group.name = `PickupSlot_${i}`
      group.visible = false
      group.scale.setScalar(PICKUP_VISUAL_RADIUS)

      const byKind = {} as Record<PickupKind, THREE.Object3D>
      for (let k = 0; k < PICKUP_KINDS.length; k++) {
        const kind = PICKUP_KINDS[k]!
        const template = templates[kind]
        const obj = template ? cloneTemplateObject(template) : createFallbackObject(kind)
        obj.visible = false
        group.add(obj)
        byKind[kind] = obj
      }

      this.group.add(group)
      this.slots.push({ group, byKind })
    }
  }

  update(pickups: readonly PickupState[], dtSec: number): void {
    const dt = Number.isFinite(dtSec) ? dtSec : 0
    this.time += dt
    const count = Math.min(pickups.length, this.capacity)

    for (let i = 0; i < count; i++) {
      const p = pickups[i]
      const slot = this.slots[i]
      if (p === undefined || slot === undefined) continue

      if (!slot.group.visible) slot.group.rotation.set(0, 0, 0)
      const bob = Math.sin(this.time * 2 + p.id) * 0.15
      slot.group.position.set(p.pos[0], p.pos[1] + bob, p.pos[2])
      slot.group.rotation.y += dt * 1.5
      slot.group.visible = true

      for (let k = 0; k < PICKUP_KINDS.length; k++) {
        const kind = PICKUP_KINDS[k]!
        slot.byKind[kind].visible = kind === p.kind
      }
    }

    for (let i = count; i < this.slots.length; i++) {
      const slot = this.slots[i]!
      slot.group.visible = false
    }
  }

  dispose(): void {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!
      for (let k = 0; k < PICKUP_KINDS.length; k++) {
        const kind = PICKUP_KINDS[k]!
        disposeObject3D(slot.byKind[kind])
      }
      this.group.remove(slot.group)
    }
    this.slots.length = 0
    this.group.parent?.remove(this.group)
  }
}
