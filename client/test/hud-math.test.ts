import { describe, expect, it } from 'vitest'
import {
  clamp,
  computePip,
  normalizeAngle,
  projectToRadar,
  shouldUpdateHud,
} from '../src/ui/hud-math'

// Testes do plano (task-4-brief, Step 1) — reproduzidos literalmente.
it('projects radar points within radius', () => {
  const p = projectToRadar({ x: 100, y: 0, z: 0 }, 50)
  expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(50)
})

it('throttles hud updates to 15hz', () => {
  expect(shouldUpdateHud(0, 1 / 60, 1 / 15)).toBe(false)
  expect(shouldUpdateHud(1 / 15, 0, 1 / 15)).toBe(true)
})

describe('hud-math helpers', () => {
  it('keeps radar points inside the radius untouched', () => {
    const p = projectToRadar({ x: 10, y: 0, z: -20 }, 50)
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(20) // -z frente aparece para cima no radar
    expect(p.depth).toBeCloseTo(-20)
  })

  it('clamps radar points to the circle edge without NaN', () => {
    const p = projectToRadar({ x: 0, y: 0, z: 0 }, 50)
    expect(p.x).toBe(0)
    expect(p.y).toBe(0)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })

  it('clamps values to the requested range', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(2, 0, 1)).toBe(1)
  })

  it('normalizes angles into [-PI, PI]', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(-Math.PI)
    expect(normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2)
  })

  it('hides pips when not visible and reuses the provided output object', () => {
    const out = { show: true, x: 1, y: 1, rot: 1 }
    const result = computePip(Math.PI / 2, false, out)
    expect(result).toBe(out)
    expect(result.show).toBe(false)
    expect(result.x).toBe(0)
    expect(result.y).toBe(0)
    expect(result.rot).toBe(0)
  })

  it('places a visible pip on the unit circle and points it outward', () => {
    const p = computePip(Math.PI / 2, true)
    expect(p.show).toBe(true)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
    expect(p.rot).toBeCloseTo(Math.PI / 2)
  })

  it('accumulates time toward the 15hz interval', () => {
    expect(shouldUpdateHud(0.05, 0.01, 1 / 15)).toBe(false)
    expect(shouldUpdateHud(0.05, 0.02, 1 / 15)).toBe(true)
  })
})
