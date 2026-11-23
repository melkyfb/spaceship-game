import { WORLD_CONFIG } from '@asteroids/shared'

export interface InterpolatorEntity {
  id: string | number
  pos: readonly [number, number, number]
  rot: readonly [number, number, number, number]
  vel?: readonly [number, number, number]
}

export interface InterpolatedState {
  pos: [number, number, number]
  rot: [number, number, number, number]
  vel?: [number, number, number]
}

export interface InterpolatorConfig {
  delayMs?: number
  maxSnapshots?: number
}

interface SnapshotFrame {
  serverTime: number
  entities: Map<string | number, InterpolatorEntity>
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function normalizeQuat(q: [number, number, number, number]): void {
  const len = Math.hypot(q[0], q[1], q[2], q[3])
  if (len <= 1e-9) {
    q[0] = 0
    q[1] = 0
    q[2] = 0
    q[3] = 1
    return
  }
  const inv = 1 / len
  q[0] *= inv
  q[1] *= inv
  q[2] *= inv
  q[3] *= inv
}

function quatDot(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

function slerpQuat(
  out: [number, number, number, number],
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number,
): void {
  let cos = quatDot(a, b)
  let bx = b[0]
  let by = b[1]
  let bz = b[2]
  let bw = b[3]
  if (cos < 0) {
    cos = -cos
    bx = -bx
    by = -by
    bz = -bz
    bw = -bw
  }

  if (cos > 0.9995) {
    out[0] = a[0] + (bx - a[0]) * t
    out[1] = a[1] + (by - a[1]) * t
    out[2] = a[2] + (bz - a[2]) * t
    out[3] = a[3] + (bw - a[3]) * t
    normalizeQuat(out)
    return
  }

  const theta = Math.acos(Math.min(1, Math.max(-1, cos)))
  const sinTheta = Math.sin(theta)
  if (sinTheta <= 1e-9) {
    out[0] = a[0]
    out[1] = a[1]
    out[2] = a[2]
    out[3] = a[3]
    normalizeQuat(out)
    return
  }
  const wa = Math.sin((1 - t) * theta) / sinTheta
  const wb = Math.sin(t * theta) / sinTheta
  out[0] = a[0] * wa + bx * wb
  out[1] = a[1] * wa + by * wb
  out[2] = a[2] * wa + bz * wb
  out[3] = a[3] * wa + bw * wb
  normalizeQuat(out)
}

function copyEntity(entity: InterpolatorEntity): InterpolatorEntity {
  const copy: InterpolatorEntity = {
    id: entity.id,
    pos: [entity.pos[0], entity.pos[1], entity.pos[2]],
    rot: [entity.rot[0], entity.rot[1], entity.rot[2], entity.rot[3]],
  }
  if (entity.vel !== undefined) {
    copy.vel = [entity.vel[0], entity.vel[1], entity.vel[2]]
  }
  return copy
}

/**
 * Buffers timestamped remote snapshots and samples entities at serverTime - delay.
 * Uses linear interpolation for pos/vel and SLERP for rotation.
 */
export class Interpolator {
  private readonly delayMs: number
  private readonly maxSnapshots: number
  private readonly frames: SnapshotFrame[] = []

  constructor(config: InterpolatorConfig = {}) {
    this.delayMs = config.delayMs ?? WORLD_CONFIG.INTERPOLATION_DELAY_MS
    this.maxSnapshots = Math.max(2, Math.trunc(config.maxSnapshots ?? 64))
  }

  /** Push a snapshot of remote entities at the given server time. */
  push(serverTime: number, entities: readonly InterpolatorEntity[]): void {
    if (!Number.isFinite(serverTime)) return
    const map = new Map<string | number, InterpolatorEntity>()
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i]
      if (e === undefined) continue
      map.set(e.id, copyEntity(e))
    }

    const frame: SnapshotFrame = { serverTime, entities: map }
    // Insert in order (usually append).
    if (this.frames.length === 0 || serverTime >= (this.frames[this.frames.length - 1]?.serverTime ?? -Infinity)) {
      this.frames.push(frame)
    } else {
      let idx = this.frames.findIndex((f) => f.serverTime > serverTime)
      if (idx < 0) idx = this.frames.length
      this.frames.splice(idx, 0, frame)
    }

    const overflow = this.frames.length - this.maxSnapshots
    if (overflow > 0) this.frames.splice(0, overflow)
  }

  /**
   * Sample an entity at render time = serverTime - delayMs into a reused out object.
   * Returns false when the entity is not present in buffered snapshots.
   * Hot-path friendly: writes into existing out.pos/out.rot/out.vel arrays.
   */
  sampleInto(entityId: string | number, serverTime: number, out: InterpolatedState): boolean {
    if (!Number.isFinite(serverTime) || this.frames.length === 0) return false
    const renderTime = serverTime - this.delayMs

    // Find bracketing frames containing the entity.
    let before: SnapshotFrame | undefined
    let after: SnapshotFrame | undefined

    for (let i = 0; i < this.frames.length; i++) {
      const frame = this.frames[i]
      if (frame === undefined) continue
      if (!frame.entities.has(entityId)) continue
      if (frame.serverTime <= renderTime) {
        before = frame
      } else {
        after = frame
        break
      }
    }

    if (before === undefined && after === undefined) return false
    if (before === undefined) before = after
    if (after === undefined) after = before
    if (before === undefined || after === undefined) return false

    const a = before.entities.get(entityId)
    const b = after.entities.get(entityId)
    if (a === undefined || b === undefined) return false

    if (before === after || after.serverTime <= before.serverTime) {
      this.writeEntityState(a, out)
      return true
    }

    const t = clamp01((renderTime - before.serverTime) / (after.serverTime - before.serverTime))
    out.pos[0] = lerp(a.pos[0], b.pos[0], t)
    out.pos[1] = lerp(a.pos[1], b.pos[1], t)
    out.pos[2] = lerp(a.pos[2], b.pos[2], t)
    slerpQuat(out.rot, a.rot, b.rot, t)

    this.writeVel(a, b, t, out)
    return true
  }

  /**
   * Sample an entity at render time = serverTime - delayMs.
   * Returns null when the entity is not present in buffered snapshots.
   * Convenience wrapper; use sampleInto on per-frame hot paths.
   */
  sample(entityId: string | number, serverTime: number): InterpolatedState | null {
    const out: InterpolatedState = { pos: [0, 0, 0], rot: [0, 0, 0, 1] }
    if (!this.sampleInto(entityId, serverTime, out)) return null
    return out
  }

  /** Clear buffered snapshots. */
  reset(): void {
    this.frames.length = 0
  }

  private writeEntityState(e: InterpolatorEntity, out: InterpolatedState): void {
    out.pos[0] = e.pos[0]
    out.pos[1] = e.pos[1]
    out.pos[2] = e.pos[2]
    out.rot[0] = e.rot[0]
    out.rot[1] = e.rot[1]
    out.rot[2] = e.rot[2]
    out.rot[3] = e.rot[3]
    if (e.vel !== undefined) {
      if (out.vel === undefined) out.vel = [e.vel[0], e.vel[1], e.vel[2]]
      else {
        out.vel[0] = e.vel[0]
        out.vel[1] = e.vel[1]
        out.vel[2] = e.vel[2]
      }
    } else {
      out.vel = undefined
    }
  }

  private writeVel(
    a: InterpolatorEntity,
    b: InterpolatorEntity,
    t: number,
    out: InterpolatedState,
  ): void {
    if (a.vel !== undefined && b.vel !== undefined) {
      if (out.vel === undefined) out.vel = [0, 0, 0]
      out.vel[0] = lerp(a.vel[0], b.vel[0], t)
      out.vel[1] = lerp(a.vel[1], b.vel[1], t)
      out.vel[2] = lerp(a.vel[2], b.vel[2], t)
      return
    }
    if (a.vel !== undefined) {
      if (out.vel === undefined) out.vel = [a.vel[0], a.vel[1], a.vel[2]]
      else {
        out.vel[0] = a.vel[0]
        out.vel[1] = a.vel[1]
        out.vel[2] = a.vel[2]
      }
      return
    }
    if (b.vel !== undefined) {
      if (out.vel === undefined) out.vel = [b.vel[0], b.vel[1], b.vel[2]]
      else {
        out.vel[0] = b.vel[0]
        out.vel[1] = b.vel[1]
        out.vel[2] = b.vel[2]
      }
      return
    }
    out.vel = undefined
  }
}
