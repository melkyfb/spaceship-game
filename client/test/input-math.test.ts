import { describe, expect, it } from 'vitest'
import { applyRadialDeadzone, applyResponseCurve, clampAxis } from '../src/input/input-math'

it('applies radial deadzone and rescales to [0,1]', () => {
  expect(applyRadialDeadzone(0.1, 0.0, 0.15)).toEqual({ x: 0, y: 0 })
  const out = applyRadialDeadzone(1, 0, 0.15)
  expect(out.x).toBeCloseTo(1)
})

it('applies exponential response curve for yaw/pitch', () => {
  expect(applyResponseCurve(0.5, 1.6)).toBeCloseTo(Math.sign(0.5) * Math.pow(0.5, 1.6))
})

describe('input-math', () => {
  it('rescales radial deadzone linearly to preserve full range', () => {
    const mid = applyRadialDeadzone(0.575, 0, 0.15)
    expect(mid.x).toBeCloseTo(0.5)
    expect(mid.y).toBeCloseTo(0)
  })

  it('preserves direction for diagonal radial deadzone', () => {
    const out = applyRadialDeadzone(1, 1, 0.15)
    expect(out.x).toBeCloseTo(out.y)
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1)
  })

  it('clamps axis to [-1, 1] and sanitizes non-finite values', () => {
    expect(clampAxis(2)).toBe(1)
    expect(clampAxis(-2)).toBe(-1)
    expect(clampAxis(0.5)).toBe(0.5)
    expect(clampAxis(NaN)).toBe(0)
    expect(clampAxis(Infinity)).toBe(0)
  })

  it('applies response curve with sign preservation', () => {
    expect(applyResponseCurve(-0.5, 1.6)).toBeCloseTo(-Math.pow(0.5, 1.6))
    expect(applyResponseCurve(0, 1.6)).toBe(0)
    expect(applyResponseCurve(1, 1.6)).toBeCloseTo(1)
  })
})
