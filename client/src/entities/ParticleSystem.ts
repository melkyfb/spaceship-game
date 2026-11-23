import * as THREE from 'three'
import type { ServerMessage } from '@asteroids/shared'

export const PARTICLE_CAPACITY = 128

interface Particle {
  active: boolean
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  age: number
  life: number
  size: number
}

function createParticle(): Particle {
  return { active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, size: 1 }
}

export class ParticleSystem {
  readonly group: THREE.Group
  private readonly mesh: THREE.InstancedMesh
  private readonly particles: Particle[] = []
  private readonly scratchMatrix = new THREE.Matrix4()
  private readonly scratchPos = new THREE.Vector3()
  private readonly scratchQuat = new THREE.Quaternion()
  private readonly scratchScale = new THREE.Vector3()
  private readonly hiddenScale = new THREE.Vector3(0, 0, 0)
  private spawnCursor = 0

  constructor(scene: THREE.Scene, capacity = PARTICLE_CAPACITY) {
    this.group = new THREE.Group()
    this.group.name = 'ParticleSystem'
    scene.add(this.group)

    for (let i = 0; i < capacity; i++) this.particles.push(createParticle())

    const geometry = new THREE.SphereGeometry(1, 6, 6)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffcc66,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity)
    this.mesh.name = 'Particles'
    this.mesh.frustumCulled = false
    this.mesh.count = capacity
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.mesh)

    // Initialize all instances hidden.
    this.scratchQuat.identity()
    for (let i = 0; i < capacity; i++) {
      this.scratchPos.set(0, 0, 0)
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.hiddenScale)
      this.mesh.setMatrixAt(i, this.scratchMatrix)
    }
    this.mesh.instanceMatrix.needsUpdate = true
  }

  emitExplosion(pos: readonly [number, number, number], scale: number): void {
    const count = Math.max(6, Math.min(18, Math.round(8 * scale)))
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2
      const phi = ((i * 1.618) % 1) * Math.PI
      const speed = (6 + (i % 5) * 2) * Math.max(0.5, scale)
      this.spawn(
        pos[0],
        pos[1],
        pos[2],
        Math.cos(theta) * Math.sin(phi) * speed,
        Math.cos(phi) * speed * 0.6,
        Math.sin(theta) * Math.sin(phi) * speed,
        0.4 + (i % 4) * 0.08,
        0.6 * Math.max(0.5, scale),
      )
    }
  }

  emitHit(pos: readonly [number, number, number], scale: number): void {
    const count = Math.max(3, Math.min(8, Math.round(4 * scale)))
    for (let i = 0; i < count; i++) {
      const theta = (i / count) * Math.PI * 2
      const speed = (3 + (i % 3) * 1.5) * Math.max(0.4, scale)
      this.spawn(
        pos[0],
        pos[1],
        pos[2],
        Math.cos(theta) * speed,
        ((i % 3) - 1) * speed * 0.4,
        Math.sin(theta) * speed,
        0.18 + (i % 3) * 0.04,
        0.35 * Math.max(0.4, scale),
      )
    }
  }

  handleEvent(event: ServerMessage & { t: 'EVENT' }): void {
    if (event.kind === 'EXPLOSION' || event.kind === 'PLAYER_DEATH') {
      this.emitExplosion(event.pos, event.scale)
      return
    }
    if (event.kind === 'HIT') {
      this.emitHit(event.pos, event.scale)
    }
  }

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    const capacity = this.particles.length
    for (let i = 0; i < capacity; i++) {
      const idx = (this.spawnCursor + i) % capacity
      const p = this.particles[idx]
      if (p === undefined || p.active) continue
      p.active = true
      p.x = x
      p.y = y
      p.z = z
      p.vx = vx
      p.vy = vy
      p.vz = vz
      p.age = 0
      p.life = life
      p.size = size
      this.spawnCursor = (idx + 1) % capacity
      return
    }
    // Pool exhausted: overwrite oldest cursor.
    const p = this.particles[this.spawnCursor]
    if (p === undefined) return
    p.active = true
    p.x = x
    p.y = y
    p.z = z
    p.vx = vx
    p.vy = vy
    p.vz = vz
    p.age = 0
    p.life = life
    p.size = size
    this.spawnCursor = (this.spawnCursor + 1) % capacity
  }

  update(dt: number): void {
    if (dt <= 0) return
    this.scratchQuat.identity()
    let anyActive = false

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]
      if (p === undefined) continue
      if (!p.active) {
        this.scratchMatrix.compose(this.scratchPos.set(0, 0, 0), this.scratchQuat, this.hiddenScale)
        this.mesh.setMatrixAt(i, this.scratchMatrix)
        continue
      }

      p.age += dt
      if (p.age >= p.life) {
        p.active = false
        this.scratchMatrix.compose(this.scratchPos.set(0, 0, 0), this.scratchQuat, this.hiddenScale)
        this.mesh.setMatrixAt(i, this.scratchMatrix)
        continue
      }

      anyActive = true
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      // simple drag
      const damp = Math.max(0, 1 - dt * 1.5)
      p.vx *= damp
      p.vy *= damp
      p.vz *= damp

      const t = p.age / p.life
      const s = p.size * (1 - t * 0.8)
      this.scratchPos.set(p.x, p.y, p.z)
      this.scratchScale.setScalar(Math.max(0, s))
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale)
      this.mesh.setMatrixAt(i, this.scratchMatrix)
    }

    if (anyActive || this.mesh.instanceMatrix.version >= 0) {
      this.mesh.instanceMatrix.needsUpdate = true
    }
  }

  dispose(): void {
    this.group.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.group.parent?.remove(this.group)
  }
}
