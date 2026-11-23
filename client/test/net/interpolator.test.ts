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
})
