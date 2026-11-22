import { describe, expect, it } from 'vitest'
import {
  FIXED_DT,
  applyMagneticBoundary,
  integrateAngularVelocity,
  integrateLinearVelocity,
  integrateRotation,
  stepShip,
} from '../src/physics'
import { SHIP_CONFIG, WORLD_CONFIG } from '../src/constants'
import type { ShipCommand, ShipState } from '../src/types'

function makeShipState(): ShipState {
  return {
    id: 'test',
    name: 'test',
    platform: 'PC',
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    shield: 100,
    energy: 100,
    score: 0,
    alive: true,
    invulnTimer: 0,
    lastProcessedTick: 0,
  }
}

function makeCommand(tick: number, overrides: Partial<ShipCommand> = {}): ShipCommand {
  return {
    tick,
    thrust: 0,
    strafeX: 0,
    strafeY: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    firePrimary: false,
    fireSecondary: false,
    boost: false,
    ...overrides,
  }
}

describe('fixed timestep & integration', () => {
  it('FIXED_DT is 1/30 from world config', () => {
    expect(WORLD_CONFIG.FIXED_TICK_RATE).toBe(30)
    expect(FIXED_DT).toBeCloseTo(1 / 30, 12)
  })

  it('exponential drag slows velocity without thrust', () => {
    const v = new Float32Array([10, 0, 0])
    integrateLinearVelocity(v, new Float32Array([0, 0, 0]), FIXED_DT, SHIP_CONFIG.LINEAR_DRAG, v)
    expect(v[0]).toBeLessThan(10)
    expect(v[0]).toBeGreaterThan(0)
  })

  it('integrateLinearVelocity matches v=(v+a*dt)*exp(-k*dt)', () => {
    const vel = new Float32Array([3, -4, 5])
    const accel = new Float32Array([1, 2, -1])
    const out = new Float32Array(3)
    const dt = 0.1
    const k = 2
    integrateLinearVelocity(vel, accel, dt, k, out)
    const decay = Math.exp(-k * dt)
    expect(out[0]).toBeCloseTo((3 + 1 * dt) * decay, 6)
    expect(out[1]).toBeCloseTo((-4 + 2 * dt) * decay, 6)
    expect(out[2]).toBeCloseTo((5 + -1 * dt) * decay, 6)
  })

  it('integrateAngularVelocity applies acceleration and drag', () => {
    const w = new Float32Array([2, 0, 0])
    const a = new Float32Array([10, 0, 0])
    const out = new Float32Array(3)
    integrateAngularVelocity(w, a, 0.1, 5, out)
    const decay = Math.exp(-5 * 0.1)
    expect(out[0]).toBeCloseTo((2 + 10 * 0.1) * decay, 6)
    expect(out[1]).toBe(0)
    expect(out[2]).toBe(0)
  })

  it('integration functions never propagate NaN/Infinity', () => {
    const outV = new Float32Array([NaN, NaN, NaN])
    integrateLinearVelocity(new Float32Array([1, NaN, Infinity]), new Float32Array([NaN, 2, 0]), NaN, NaN, outV)
    expect(Array.from(outV).every(Number.isFinite)).toBe(true)

    const outW = new Float32Array([NaN, NaN, NaN])
    integrateAngularVelocity(new Float32Array([1, NaN, 0]), new Float32Array([0, 0, Infinity]), Infinity, 1, outW)
    expect(Array.from(outW).every(Number.isFinite)).toBe(true)
  })
})

describe('quaternion rotation', () => {
  it('integrateRotation leaves the quaternion unchanged for omega <= 1e-5', () => {
    const q: [number, number, number, number] = [0, 0, 0, 1]
    const w = new Float32Array([1e-7, 0, 0])
    const out: [number, number, number, number] = [0, 0, 0, 0]
    integrateRotation(q, w, FIXED_DT, out)
    expect(Array.from(out)).toEqual([0, 0, 0, 1])
  })

  it('integrateRotation applies omega*dt and keeps the quaternion normalized', () => {
    const q: [number, number, number, number] = [0, 0, 0, 1]
    const w = new Float32Array([0, 2, 0]) // omega = 2 rad/s about +Y
    const out: [number, number, number, number] = [0, 0, 0, 0]
    integrateRotation(q, w, 0.1, out) // angle = 0.2 rad, half = 0.1
    expect(out[1]).toBeCloseTo(Math.sin(0.1), 6)
    expect(out[3]).toBeCloseTo(Math.cos(0.1), 6)
    expect(Math.hypot(out[0], out[1], out[2], out[3])).toBeCloseTo(1, 6)
  })

  it('integrateRotation never propagates NaN into the quaternion', () => {
    const q: [number, number, number, number] = [0, 0, 0, 1]
    const w = new Float32Array([NaN, Infinity, 0])
    const out: [number, number, number, number] = [0, 0, 0, 0]
    integrateRotation(q, w, FIXED_DT, out)
    expect(out.every(Number.isFinite)).toBe(true)
  })
})

describe('magnetic boundary', () => {
  it('magnetic boundary pushes inward beyond 450u', () => {
    const pos = new Float32Array([460, 0, 0])
    const vel = new Float32Array([20, 0, 0])
    const accel = new Float32Array([0, 0, 0])
    applyMagneticBoundary(pos, vel, accel)
    expect(accel[0]).toBeLessThan(0)
  })

  it('magnetic boundary is a no-op at or inside 450u', () => {
    const pos = new Float32Array([440, 0, 0])
    const vel = new Float32Array([20, 0, 0])
    const velBefore = Array.from(vel)
    const accel = new Float32Array([0, 0, 0])
    applyMagneticBoundary(pos, vel, accel)
    expect(Array.from(accel)).toEqual([0, 0, 0])
    expect(Array.from(vel)).toEqual(velBefore)
  })

  it('magnetic boundary damps outward radial velocity (documented formula)', () => {
    const pos = new Float32Array([470, 0, 0])
    const vel = new Float32Array([30, 0, 0])
    const accel = new Float32Array([0, 0, 0])
    applyMagneticBoundary(pos, vel, accel)
    // vr = 30; v -= n*vr*BOUNDARY_RADIAL_DAMPING*FIXED_DT = 30*3.0*(1/30) = 3
    expect(vel[0]).toBeCloseTo(30 - 30 * WORLD_CONFIG.BOUNDARY_RADIAL_DAMPING * FIXED_DT, 5)
    expect(vel[0]).toBeLessThan(30)
  })

  it('magnetic boundary adds to existing accel and does not damp inward velocity', () => {
    const pos = new Float32Array([470, 0, 0])
    const vel = new Float32Array([-30, 0, 0])
    const accel = new Float32Array([5, 0, 0]) // empuxo prévio deve ser preservado (aditivo)
    applyMagneticBoundary(pos, vel, accel)
    expect(vel[0]).toBe(-30)
    expect(accel[0]).toBeLessThan(5) // mola negativa somada ao empuxo
  })
})

describe('stepShip', () => {
  it('clamps axes to [-1,1] and ignores NaN/Infinity', () => {
    const a = makeShipState()
    const b = makeShipState()
    stepShip(a, makeCommand(1, { thrust: 5, strafeX: NaN, yaw: Infinity, pitch: -Infinity, roll: -5 }))
    stepShip(b, makeCommand(1, { thrust: 1, strafeX: 0, yaw: 0, pitch: 0, roll: -1 }))
    expect(a.pos).toEqual(b.pos)
    expect(a.vel).toEqual(b.vel)
    expect(a.angVel).toEqual(b.angVel)
    expect(a.rot).toEqual(b.rot)
  })

  it('sanitizes non-finite state values instead of propagating them', () => {
    const s = makeShipState()
    s.vel = [NaN, Infinity, 1]
    s.angVel = [0, 0, NaN]
    s.rot = [0, 0, 0, NaN]
    stepShip(s, makeCommand(1, { thrust: 1 }))
    expect(s.pos.every(Number.isFinite)).toBe(true)
    expect(s.vel.every(Number.isFinite)).toBe(true)
    expect(s.rot.every(Number.isFinite)).toBe(true)
    expect(s.angVel.every(Number.isFinite)).toBe(true)
  })

  it('writes in place without replacing state arrays (zero-alloc proxy)', () => {
    const s = makeShipState()
    const posRef = s.pos, velRef = s.vel, rotRef = s.rot, angRef = s.angVel
    for (let i = 0; i < 10; i++) stepShip(s, makeCommand(i + 1, { thrust: 1 }))
    expect(s.pos).toBe(posRef)
    expect(s.vel).toBe(velRef)
    expect(s.rot).toBe(rotRef)
    expect(s.angVel).toBe(angRef)
  })

  it('same input sequence yields identical final state', () => {
    const a = makeShipState()
    const b = makeShipState()
    for (let i = 0; i < 200; i++) {
      const cmd = makeCommand(i + 1, {
        thrust: Math.sin(i * 0.31),
        strafeX: Math.cos(i * 0.17),
        strafeY: Math.sin(i * 0.11) * 0.5,
        yaw: Math.sin(i * 0.07),
        pitch: Math.cos(i * 0.13),
        roll: Math.sin(i * 0.23) * 0.5,
        boost: i % 9 === 0,
      })
      stepShip(a, cmd)
      stepShip(b, cmd)
    }
    expect(a.pos).toEqual(b.pos)
    expect(a.vel).toEqual(b.vel)
    expect(a.rot).toEqual(b.rot)
    expect(a.angVel).toEqual(b.angVel)
  })

  it('ignores external dt and always simulates at FIXED_DT (ADR-06)', () => {
    const a = makeShipState()
    const b = makeShipState()
    const c = makeShipState()
    const cmd = makeCommand(1, { thrust: 1, yaw: 0.5, boost: true })
    stepShip(a, cmd)
    stepShip(b, cmd, 1 / 60)
    stepShip(c, cmd, 999)
    expect(a.pos).toEqual(b.pos)
    expect(a.vel).toEqual(b.vel)
    expect(a.rot).toEqual(b.rot)
    expect(a.angVel).toEqual(b.angVel)
    expect(a.pos).toEqual(c.pos)
    expect(a.vel).toEqual(c.vel)
  })

  it('boosting outward at boundary does not escape hard limit', () => {
    const s = makeShipState()
    // voltar a nave para +X (frente local -Z -> +X) e empurrar para fora
    s.pos = [WORLD_CONFIG.SOFT_BOUNDARY_START - 1, 0, 0]
    s.vel = [SHIP_CONFIG.MAX_SPEED * SHIP_CONFIG.BOOST_MULTIPLIER, 0, 0]
    s.rot = [0, -Math.SQRT1_2, 0, Math.SQRT1_2] // -90deg sobre Y

    let maxR = 0
    for (let i = 0; i < 120; i++) {
      stepShip(s, makeCommand(i + 1, { thrust: 1, boost: true }))
      maxR = Math.max(maxR, Math.hypot(s.pos[0], s.pos[1], s.pos[2]))
    }
    expect(maxR).toBeLessThanOrEqual(WORLD_CONFIG.HARD_BOUNDARY_LIMIT)

    // com o empuxo interrompido, a fronteira devolve a nave para dentro
    for (let i = 0; i < 180; i++) stepShip(s, makeCommand(200 + i, {}))
    const finalR = Math.hypot(s.pos[0], s.pos[1], s.pos[2])
    expect(finalR).toBeLessThan(maxR)
    expect(finalR).toBeLessThan(WORLD_CONFIG.SOFT_BOUNDARY_START + 20)
  })
})
