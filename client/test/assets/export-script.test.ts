import { describe, expect, it } from 'vitest'
import sources from '../../../scripts/assets/sources.p1.json'

describe('p1 export sources', () => {
  it('maps to runtime glb outputs', () => {
    expect(Array.isArray(sources)).toBe(true)
    for (const s of sources) {
      expect(s.output).toMatch(/^client\/public\/assets\/models\/.+\.glb$/)
      expect(typeof s.source).toBe('string')
    }
  })
})
