import { describe, expect, it } from 'vitest'
import { applyRadialDeadzone } from '../src/input/input-math'
import {
  assignTouchToSide,
  normalizeTouchJoystick,
  type TouchSideAssignment,
} from '../src/input/TouchInput'

describe('touch-input-math', () => {
  it('normalizes touch delta from center with radial deadzone and rescale', () => {
    const radius = 100
    const centerX = 200
    const centerY = 300

    expect(normalizeTouchJoystick(centerX, centerY, centerX + 10, centerY, radius, 0.15)).toEqual({
      x: 0,
      y: 0,
    })

    const edge = normalizeTouchJoystick(centerX, centerY, centerX + 100, centerY, radius, 0.15)
    expect(edge.x).toBeCloseTo(1)
    expect(edge.y).toBeCloseTo(0)

    const mid = normalizeTouchJoystick(centerX, centerY, centerX + 57.5, centerY, radius, 0.15)
    expect(mid.x).toBeCloseTo(0.5, 1)
    expect(mid.y).toBeCloseTo(0)

    const expected = applyRadialDeadzone(0.6, -0.8, 0.15)
    const diag = normalizeTouchJoystick(centerX, centerY, centerX + 60, centerY - 80, radius, 0.15)
    expect(diag.x).toBeCloseTo(expected.x)
    expect(diag.y).toBeCloseTo(expected.y)
  })

  it('assigns touches to left/right sides without crossing identifiers', () => {
    const width = 1000
    const assignments = new Map<number, TouchSideAssignment>()

    expect(assignTouchToSide(1, 100, width, assignments)).toBe('left')
    expect(assignTouchToSide(2, 900, width, assignments)).toBe('right')

    // Existing identifiers keep their side even if they cross the midpoint.
    expect(assignTouchToSide(1, 900, width, assignments)).toBe('left')
    expect(assignTouchToSide(2, 100, width, assignments)).toBe('right')

    // New touch on occupied side should not steal the other side's identifier.
    expect(assignTouchToSide(3, 100, width, assignments)).toBe('left')
  })
})
