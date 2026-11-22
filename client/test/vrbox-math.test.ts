import { describe, expect, it } from 'vitest'
import {
  applyGamepadAxisCalibration,
  deviceOrientationToQuaternionYXZ,
  type QuatLike,
} from '../src/input/vrbox-math'

function approxQuat(q: QuatLike, expected: QuatLike, eps = 1e-5): void {
  expect(q.x).toBeCloseTo(expected.x, 5)
  expect(q.y).toBeCloseTo(expected.y, 5)
  expect(q.z).toBeCloseTo(expected.z, 5)
  expect(q.w).toBeCloseTo(expected.w, 5)
  // ensure normalized-ish
  const len = Math.hypot(q.x, q.y, q.z, q.w)
  expect(len).toBeGreaterThan(1 - eps)
  expect(len).toBeLessThan(1 + eps)
}

describe('vrbox-math', () => {
  it('converts zero device orientation to identity quaternion', () => {
    const out: QuatLike = { x: 0, y: 0, z: 0, w: 1 }
    deviceOrientationToQuaternionYXZ(0, 0, 0, out)
    approxQuat(out, { x: 0, y: 0, z: 0, w: 1 })
  })

  it('converts 90deg yaw (alpha) using YXZ order', () => {
    const out: QuatLike = { x: 0, y: 0, z: 0, w: 1 }
    deviceOrientationToQuaternionYXZ(90, 0, 0, out)
    // 90 deg around Y: (0, sin(45), 0, cos(45))
    const s = Math.sin(Math.PI / 4)
    const c = Math.cos(Math.PI / 4)
    approxQuat(out, { x: 0, y: s, z: 0, w: c })
  })

  it('converts 90deg pitch (beta) using YXZ order', () => {
    const out: QuatLike = { x: 0, y: 0, z: 0, w: 1 }
    deviceOrientationToQuaternionYXZ(0, 90, 0, out)
    const s = Math.sin(Math.PI / 4)
    const c = Math.cos(Math.PI / 4)
    approxQuat(out, { x: s, y: 0, z: 0, w: c })
  })

  it('converts 90deg roll (gamma) using YXZ order', () => {
    const out: QuatLike = { x: 0, y: 0, z: 0, w: 1 }
    deviceOrientationToQuaternionYXZ(0, 0, 90, out)
    const s = Math.sin(Math.PI / 4)
    const c = Math.cos(Math.PI / 4)
    approxQuat(out, { x: 0, y: 0, z: s, w: c })
  })

  it('is deterministic and writes into output without allocating return requirement', () => {
    const out: QuatLike = { x: 9, y: 9, z: 9, w: 9 }
    const ret = deviceOrientationToQuaternionYXZ(30, 15, -10, out)
    expect(ret).toBe(out)
    expect(Number.isFinite(out.x)).toBe(true)
    expect(Number.isFinite(out.w)).toBe(true)
  })

  it('handles non-finite inputs safely', () => {
    const out: QuatLike = { x: 1, y: 2, z: 3, w: 4 }
    deviceOrientationToQuaternionYXZ(Number.NaN, undefined as unknown as number, Infinity, out)
    approxQuat(out, { x: 0, y: 0, z: 0, w: 1 })
  })

  it('calibrates gamepad axis with deadzone/inversion/clamp', () => {
    expect(applyGamepadAxisCalibration(0.1, 0.15, false)).toBe(0)
    expect(applyGamepadAxisCalibration(1, 0.15, false)).toBeCloseTo(1)
    expect(applyGamepadAxisCalibration(1, 0.15, true)).toBeCloseTo(-1)
    expect(applyGamepadAxisCalibration(-0.5, 0, false)).toBeCloseTo(-0.5)
    expect(applyGamepadAxisCalibration(2, 0, false)).toBe(1)
    expect(applyGamepadAxisCalibration(Number.NaN, 0.15, false)).toBe(0)
  })
})
