import { describe, expect, it } from 'vitest'
import { clamp, isFiniteNumber, SpatialHash3D, sweptSegmentSphere, sweptSphereSphere } from '../src/math'

describe('swept collision (continuous)', () => {
  it('detects fast projectile hitting small asteroid', () => {
    // projectile 240 u/s, dt 1/30 => 8u segment; asteroid SMALL r=3 at origin
    const hit = sweptSegmentSphere(-4, 0, 0, 4, 0, 0, 0, 0, 0, 3.2)
    expect(hit.hit).toBe(true)
    expect(hit.t).toBeGreaterThanOrEqual(0)
    expect(hit.t).toBeLessThanOrEqual(1)
  })

  it('misses when the segment stays outside the radius', () => {
    const hit = sweptSegmentSphere(-4, 10, 0, 4, 10, 0, 0, 0, 0, 3.2)
    expect(hit.hit).toBe(false)
  })

  it('reports a contact normal pointing away from the sphere center', () => {
    const hit = sweptSegmentSphere(-4, 2, 0, 4, 2, 0, 0, 0, 0, 3.2)
    expect(hit.hit).toBe(true)
    // closest approach is (-? ,2,0) -> normal mostly +Y
    expect(hit.ny).toBeGreaterThan(0)
    expect(Math.hypot(hit.nx, hit.ny, hit.nz)).toBeCloseTo(1, 5)
  })

  it('boosting ship does not tunnel through asteroid (sphere-sphere swept)', () => {
    // ship radius 2.2 + SMALL asteroid radius 3 => combined r = 5.2.
    // boost speed 113.75 u/s, dt = 1/30 => ~3.79 u per tick.
    // Both endpoints are outside the combined radius, but the path crosses it.
    const shipR = 2.2
    const asteroidR = 3
    const r = shipR + asteroidR
    const speed = 113.75
    const dt = 1 / 30 // FIXED_DT from WORLD_CONFIG.FIXED_TICK_RATE

    const hit = sweptSphereSphere(
      -speed * dt * 0.5, -5, 0, // ship pos: endpoints at +/-1.895 on X, y=-5
      speed, 0, 0, // ship velocity (boost, +X)
      0, 0, 0, // asteroid pos
      0, 0, 0, // asteroid velocity
      r,
      dt,
    )

    // sanity: discrete endpoint distances are > r (a point test would miss)
    const endpointDist = Math.hypot(speed * dt * 0.5, 5)
    expect(endpointDist).toBeGreaterThan(r)

    expect(hit.hit).toBe(true)
    expect(hit.t).toBeGreaterThanOrEqual(0)
    expect(hit.t).toBeLessThanOrEqual(1)
    expect(hit.ny).toBeLessThan(0) // normal points from asteroid center toward the ship path (y = -5)
  })

  it('returns no hit for NaN/Infinity swept inputs', () => {
    const nanHit = sweptSegmentSphere(NaN, 0, 0, 4, 0, 0, 0, 0, 0, 3)
    expect(nanHit.hit).toBe(false)
    expect(nanHit.t).toBe(0)
    expect(nanHit.nx).toBe(0)
    expect(nanHit.ny).toBe(0)
    expect(nanHit.nz).toBe(0)

    expect(sweptSegmentSphere(-4, 0, 0, Infinity, 0, 0, 0, 0, 0, 3).hit).toBe(false)
    expect(sweptSegmentSphere(-4, 0, 0, 4, 0, 0, 0, 0, 0, NaN).hit).toBe(false)

    const badDt = sweptSphereSphere(0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 5, NaN)
    expect(badDt.hit).toBe(false)
    expect(badDt.t).toBe(0)
    expect(sweptSphereSphere(0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 5, Infinity).hit).toBe(false)
    expect(sweptSphereSphere(NaN, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 5, 1 / 30).hit).toBe(false)
  })
})

describe('SpatialHash3D', () => {
  it('returns nearby ids in same/neighbor cells', () => {
    const h = new SpatialHash3D(40)
    h.insert(1, [0, 0, 0], 3)
    h.insert(2, [39, 0, 0], 3)
    h.insert(3, [200, 0, 0], 3)
    const out: number[] = []
    h.query([10, 0, 0], 5, out)
    expect(out).toContain(1)
    expect(out).toContain(2)
    expect(out).not.toContain(3)
  })

  it('clears the out array on every query and does not duplicate ids', () => {
    const h = new SpatialHash3D(40)
    h.insert(7, [0, 0, 0], 12) // overlaps several cells
    const out: number[] = [99, 99]
    h.query([0, 0, 0], 5, out)
    expect(out).toEqual([7])

    out.push(123)
    h.query([500, 500, 500], 1, out)
    expect(out).toEqual([])
  })

  it('clear() removes all inserted ids', () => {
    const h = new SpatialHash3D(40)
    h.insert(1, [0, 0, 0], 3)
    const out: number[] = []
    h.clear()
    h.query([0, 0, 0], 3, out)
    expect(out).toEqual([])
  })

  it('ignores non-finite pos/radius without hanging or corrupting results', () => {
    const h = new SpatialHash3D(40)
    h.insert(1, [0, 0, 0], 3)

    const out: number[] = [99]
    h.insert(2, [NaN, 0, 0], 3)
    h.insert(3, [0, Infinity, 0], 3)
    h.insert(4, [0, 0, 0], Infinity)
    h.insert(5, [0, 0, 0], NaN)
    h.query([0, 0, 0], 3, out)
    expect(out).toEqual([1])

    out.push(42)
    h.query([NaN, 0, 0], 3, out)
    expect(out).toEqual([])
    h.query([0, 0, 0], Infinity, out)
    expect(out).toEqual([])
    h.query([0, 0, 0], NaN, out)
    expect(out).toEqual([])
  })
})

describe('numeric helpers', () => {
  it('clamp bounds values', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('isFiniteNumber rejects NaN, Infinity and non-numbers', () => {
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(-12.5)).toBe(true)
    expect(isFiniteNumber(NaN)).toBe(false)
    expect(isFiniteNumber(Infinity)).toBe(false)
    expect(isFiniteNumber(-Infinity)).toBe(false)
    expect(isFiniteNumber('3')).toBe(false)
    expect(isFiniteNumber(null)).toBe(false)
    expect(isFiniteNumber(undefined)).toBe(false)
  })
})
