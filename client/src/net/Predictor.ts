import { stepShip, type ShipCommand, type ShipState } from '@asteroids/shared'

export interface PredictorConfig {
  /** Position distance above which correction snaps instead of smoothing. Default 20. */
  snapThreshold?: number
  /** Exponential decay rate per second for visual correction offset. Default 12. */
  correctionDecayPerSec?: number
  /** Max buffered local commands. Default 128. */
  maxCommands?: number
}

function cloneShip(src: ShipState, out: ShipState): void {
  out.id = src.id
  out.name = src.name
  out.platform = src.platform
  out.pos[0] = src.pos[0]
  out.pos[1] = src.pos[1]
  out.pos[2] = src.pos[2]
  out.vel[0] = src.vel[0]
  out.vel[1] = src.vel[1]
  out.vel[2] = src.vel[2]
  out.rot[0] = src.rot[0]
  out.rot[1] = src.rot[1]
  out.rot[2] = src.rot[2]
  out.rot[3] = src.rot[3]
  out.angVel[0] = src.angVel[0]
  out.angVel[1] = src.angVel[1]
  out.angVel[2] = src.angVel[2]
  out.shield = src.shield
  out.energy = src.energy
  out.score = src.score
  out.alive = src.alive
  out.invulnTimer = src.invulnTimer
  out.lastProcessedTick = src.lastProcessedTick
}

function copyCommand(src: ShipCommand): ShipCommand {
  return {
    tick: src.tick,
    thrust: src.thrust,
    strafeX: src.strafeX,
    strafeY: src.strafeY,
    yaw: src.yaw,
    pitch: src.pitch,
    roll: src.roll,
    firePrimary: src.firePrimary,
    fireSecondary: src.fireSecondary,
    boost: src.boost,
  }
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

// Multiply q = a * b (quaternion, [x,y,z,w])
function quatMul(
  out: [number, number, number, number],
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3]
  const bx = b[0], by = b[1], bz = b[2], bw = b[3]
  out[0] = ax * bw + aw * bx + ay * bz - az * by
  out[1] = ay * bw + aw * by + az * bx - ax * bz
  out[2] = az * bw + aw * bz + ax * by - ay * bx
  out[3] = aw * bw - ax * bx - ay * by - az * bz
}

function quatConjugate(out: [number, number, number, number], q: readonly [number, number, number, number]): void {
  out[0] = -q[0]
  out[1] = -q[1]
  out[2] = -q[2]
  out[3] = q[3]
}

function quatDot(a: readonly [number, number, number, number], b: readonly [number, number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
}

function quatNlerp(
  out: [number, number, number, number],
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number,
): void {
  // Ensure shortest path
  let sign = 1
  if (quatDot(a, b) < 0) sign = -1
  out[0] = a[0] + (b[0] * sign - a[0]) * t
  out[1] = a[1] + (b[1] * sign - a[1]) * t
  out[2] = a[2] + (b[2] * sign - a[2]) * t
  out[3] = a[3] + (b[3] * sign - a[3]) * t
  normalizeQuat(out)
}

/**
 * Client-side prediction with authoritative reconciliation and visual error smoothing.
 * Reconciles only the local predicted ship by `authoritative.lastProcessedTick`.
 */
export class Predictor {
  private readonly snapThresholdSq: number
  private readonly correctionDecayPerSec: number
  private readonly maxCommands: number
  private readonly commands: ShipCommand[] = []
  private correctionPos: [number, number, number] = [0, 0, 0]
  private correctionRot: [number, number, number, number] = [0, 0, 0, 1]
  private hasCorrection = false
  private readonly scratchQuat: [number, number, number, number] = [0, 0, 0, 1]
  private readonly scratchQuat2: [number, number, number, number] = [0, 0, 0, 1]

  constructor(config: PredictorConfig = {}) {
    const snap = config.snapThreshold ?? 20
    this.snapThresholdSq = snap * snap
    this.correctionDecayPerSec = config.correctionDecayPerSec ?? 12
    this.maxCommands = Math.max(1, Math.trunc(config.maxCommands ?? 128))
  }

  /** Record a local command for replay during reconciliation. */
  pushCommand(cmd: ShipCommand): void {
    this.commands.push(copyCommand(cmd))
    const overflow = this.commands.length - this.maxCommands
    if (overflow > 0) {
      this.commands.splice(0, overflow)
    }
  }

  /** Apply a local prediction step in place and record the command. */
  predict(ship: ShipState, cmd: ShipCommand): void {
    this.pushCommand(cmd)
    stepShip(ship, cmd)
    ship.lastProcessedTick = Math.max(ship.lastProcessedTick, Math.trunc(cmd.tick))
  }

  /**
   * Reconcile predicted local ship against authoritative snapshot ship.
   * Replays commands with tick > authoritative.lastProcessedTick.
   * Stores visual correction offset so display does not teleport.
   */
  reconcile(predicted: ShipState, authoritative: ShipState): void {
    const ackTick = Math.trunc(authoritative.lastProcessedTick)

    // Drop acknowledged commands.
    while (this.commands.length > 0) {
      const first = this.commands[0]
      if (first !== undefined && first.tick <= ackTick) {
        this.commands.shift()
      } else {
        break
      }
    }

    // Capture old display position (predicted + current correction) for smoothing.
    const oldDisplayPos: [number, number, number] = [
      predicted.pos[0] + (this.hasCorrection ? this.correctionPos[0] : 0),
      predicted.pos[1] + (this.hasCorrection ? this.correctionPos[1] : 0),
      predicted.pos[2] + (this.hasCorrection ? this.correctionPos[2] : 0),
    ]
    const oldDisplayRot: [number, number, number, number] = [predicted.rot[0], predicted.rot[1], predicted.rot[2], predicted.rot[3]]
    if (this.hasCorrection) {
      // display rot = predicted rot * correctionRot
      quatMul(this.scratchQuat, predicted.rot, this.correctionRot)
      oldDisplayRot[0] = this.scratchQuat[0]
      oldDisplayRot[1] = this.scratchQuat[1]
      oldDisplayRot[2] = this.scratchQuat[2]
      oldDisplayRot[3] = this.scratchQuat[3]
      normalizeQuat(oldDisplayRot)
    }

    // Reset predicted to authoritative.
    cloneShip(authoritative, predicted)

    // Replay unacked commands.
    for (let i = 0; i < this.commands.length; i++) {
      const cmd = this.commands[i]
      if (cmd === undefined) continue
      if (cmd.tick <= ackTick) continue
      stepShip(predicted, cmd)
      predicted.lastProcessedTick = Math.max(predicted.lastProcessedTick, Math.trunc(cmd.tick))
    }

    // Compute correction so old display = new predicted + correction.
    const dx = oldDisplayPos[0] - predicted.pos[0]
    const dy = oldDisplayPos[1] - predicted.pos[1]
    const dz = oldDisplayPos[2] - predicted.pos[2]
    const distSq = dx * dx + dy * dy + dz * dz

    if (distSq > this.snapThresholdSq) {
      // Extreme desync: snap, no smoothing.
      this.correctionPos[0] = 0
      this.correctionPos[1] = 0
      this.correctionPos[2] = 0
      this.correctionRot[0] = 0
      this.correctionRot[1] = 0
      this.correctionRot[2] = 0
      this.correctionRot[3] = 1
      this.hasCorrection = false
      return
    }

    this.correctionPos[0] = dx
    this.correctionPos[1] = dy
    this.correctionPos[2] = dz

    // correctionRot = inv(predicted.rot) * oldDisplayRot
    quatConjugate(this.scratchQuat, predicted.rot)
    quatMul(this.correctionRot, this.scratchQuat, oldDisplayRot)
    normalizeQuat(this.correctionRot)

    this.hasCorrection = distSq > 1e-10 || Math.abs(quatDot(this.correctionRot, [0, 0, 0, 1])) < 0.999999
  }

  /** Decay visual correction offset over time (exponential). */
  decayCorrection(dt: number): void {
    if (!this.hasCorrection) return
    if (!Number.isFinite(dt) || dt <= 0) return
    const t = 1 - Math.exp(-this.correctionDecayPerSec * dt)
    const alpha = t < 0 ? 0 : t > 1 ? 1 : t

    this.correctionPos[0] += (0 - this.correctionPos[0]) * alpha
    this.correctionPos[1] += (0 - this.correctionPos[1]) * alpha
    this.correctionPos[2] += (0 - this.correctionPos[2]) * alpha

    quatNlerp(this.scratchQuat2, this.correctionRot, [0, 0, 0, 1], alpha)
    this.correctionRot[0] = this.scratchQuat2[0]
    this.correctionRot[1] = this.scratchQuat2[1]
    this.correctionRot[2] = this.scratchQuat2[2]
    this.correctionRot[3] = this.scratchQuat2[3]

    const posDistSq =
      this.correctionPos[0] * this.correctionPos[0] +
      this.correctionPos[1] * this.correctionPos[1] +
      this.correctionPos[2] * this.correctionPos[2]
    const rotClose = Math.abs(quatDot(this.correctionRot, [0, 0, 0, 1])) > 0.999999
    if (posDistSq < 1e-10 && rotClose) {
      this.correctionPos[0] = 0
      this.correctionPos[1] = 0
      this.correctionPos[2] = 0
      this.correctionRot[0] = 0
      this.correctionRot[1] = 0
      this.correctionRot[2] = 0
      this.correctionRot[3] = 1
      this.hasCorrection = false
    }
  }

  /** Write predicted + visual correction into out. */
  getDisplayState(predicted: ShipState, out: ShipState): void {
    cloneShip(predicted, out)
    if (!this.hasCorrection) return
    out.pos[0] = predicted.pos[0] + this.correctionPos[0]
    out.pos[1] = predicted.pos[1] + this.correctionPos[1]
    out.pos[2] = predicted.pos[2] + this.correctionPos[2]
    quatMul(this.scratchQuat, predicted.rot, this.correctionRot)
    normalizeQuat(this.scratchQuat)
    out.rot[0] = this.scratchQuat[0]
    out.rot[1] = this.scratchQuat[1]
    out.rot[2] = this.scratchQuat[2]
    out.rot[3] = this.scratchQuat[3]
  }

  /** Magnitude of current visual correction offset. */
  getCorrectionDistance(): number {
    if (!this.hasCorrection) return 0
    return Math.hypot(this.correctionPos[0], this.correctionPos[1], this.correctionPos[2])
  }

  /** Clear buffered commands and correction. */
  reset(): void {
    this.commands.length = 0
    this.correctionPos[0] = 0
    this.correctionPos[1] = 0
    this.correctionPos[2] = 0
    this.correctionRot[0] = 0
    this.correctionRot[1] = 0
    this.correctionRot[2] = 0
    this.correctionRot[3] = 1
    this.hasCorrection = false
  }
}
