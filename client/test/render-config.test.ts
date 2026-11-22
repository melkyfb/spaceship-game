import { describe, expect, it } from 'vitest'
import { BARREL_K1, BARREL_K2, IPD_MAX_MM, IPD_MIN_MM, MAX_DPR } from '../src/core/render-config'
import { clampIpdMm } from '../src/core/render-config'

it('matches spec barrel and dpr constants', () => {
  expect(BARREL_K1).toBe(0.22)
  expect(BARREL_K2).toBe(0.24)
  expect(IPD_MIN_MM).toBe(56)
  expect(IPD_MAX_MM).toBe(74)
  expect(MAX_DPR).toBe(2)
})

it('clamps IPD adjustments to the spec range', () => {
  expect(clampIpdMm(10)).toBe(IPD_MIN_MM)
  expect(clampIpdMm(100)).toBe(IPD_MAX_MM)
  expect(clampIpdMm(64)).toBe(64)
})
