import { describe, expect, it } from 'vitest'
import sources from '../../../scripts/assets/sources.p1.json'
import { buildBlenderArgs } from '../../../scripts/assets/export-glb.mjs'

describe('p1 export sources', () => {
  it('maps to runtime glb outputs', () => {
    expect(Array.isArray(sources)).toBe(true)
    for (const s of sources) {
      expect(s.output).toMatch(/^client\/public\/assets\/models\/.+\.glb$/)
      expect(typeof s.source).toBe('string')
    }
  })

  it('builds blender args with forward as single --forward=-Z value', () => {
    const args = buildBlenderArgs({
      scriptPath: '/tmp/blender_export.py',
      sourcePath: '/tmp/ship.fbx',
      outputPath: '/tmp/ship.glb',
      forward: '-Z',
      targetRadius: 2.2,
      nodeFilter: null,
      rotationDeg: [0, 0, 0],
      id: 'player_ship',
    })

    expect(args).toContain('--forward=-Z')
    expect(args).not.toContain('--forward')
    expect(args).not.toContain('-Z')
    expect(args).toContain('--target-radius')
    expect(args).toContain('2.2')
    expect(args).toContain('--rotation-deg')
    expect(args).toContain('0,0,0')
  })
})
