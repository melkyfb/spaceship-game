import { describe, expect, it } from 'vitest'
import { Interpolator } from '../../src/net/Interpolator'

describe('Interpolator', () => {
  it('returns position interpolated between snapshots at serverTime - delay', () => {
    const interp = new Interpolator({ delayMs: 100 })

    interp.push(0, [{ id: 'e1', pos: [0, 0, 0], rot: [0, 0, 0, 1] }])
    interp.push(100, [{ id: 'e1', pos: [10, 0, 0], rot: [0, 0, 0, 1] }])

    // renderTime = serverTime - delay = 50ms => midpoint
    const sample = interp.sample('e1', 150)
    expect(sample).not.toBeNull()
    expect(sample!.pos[0]).toBeCloseTo(5, 5)
    expect(sample!.pos[1]).toBeCloseTo(0, 5)
    expect(sample!.pos[2]).toBeCloseTo(0, 5)
  })

  it('clamps to latest snapshot when render time is ahead', () => {
    const interp = new Interpolator({ delayMs: 100 })
    interp.push(0, [{ id: 'e1', pos: [0, 0, 0], rot: [0, 0, 0, 1] }])
    interp.push(100, [{ id: 'e1', pos: [10, 0, 0], rot: [0, 0, 0, 1] }])

    const sample = interp.sample('e1', 500)
    expect(sample).not.toBeNull()
    expect(sample!.pos[0]).toBeCloseTo(10, 5)
  })

  it('returns null for unknown entity', () => {
    const interp = new Interpolator({ delayMs: 100 })
    interp.push(0, [{ id: 'e1', pos: [0, 0, 0], rot: [0, 0, 0, 1] }])
    expect(interp.sample('missing', 150)).toBeNull()
  })

  it('sampleInto writes into reused output without allocating result object', () => {
    const interp = new Interpolator({ delayMs: 100 })
    interp.push(0, [{ id: 'e1', pos: [0, 0, 0], rot: [0, 0, 0, 1], vel: [0, 0, 0] }])
    interp.push(100, [{ id: 'e1', pos: [10, 0, 0], rot: [0, 0, 0, 1], vel: [10, 0, 0] }])

    const out = { pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0, 1] as [number, number, number, number], vel: [0, 0, 0] as [number, number, number] }
    const posRef = out.pos
    const rotRef = out.rot
    const velRef = out.vel

    const ok = interp.sampleInto('e1', 150, out)
    expect(ok).toBe(true)
    expect(out.pos).toBe(posRef)
    expect(out.rot).toBe(rotRef)
    expect(out.vel).toBe(velRef)
    expect(out.pos[0]).toBeCloseTo(5, 5)
    expect(out.vel?.[0]).toBeCloseTo(5, 5)

    expect(interp.sampleInto('missing', 150, out)).toBe(false)
  })
})
