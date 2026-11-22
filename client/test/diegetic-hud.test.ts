import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { DiegeticHUD } from '../src/ui/DiegeticHUD'
import type { HudState } from '../src/ui/hud-math'

function createFakeContext(): CanvasRenderingContext2D {
  return {
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
  } as unknown as CanvasRenderingContext2D
}

const STATIC_STATE: HudState = {
  shield: 0.5,
  energy: 0.5,
  score: 100,
  wave: 1,
  contacts: [],
}

function makeHud(): { hud: DiegeticHUD; texture: THREE.CanvasTexture; ctx: CanvasRenderingContext2D } {
  const ctx = createFakeContext()
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
  const hud = new DiegeticHUD(mesh)
  const texture = (hud as unknown as { texture: THREE.CanvasTexture }).texture
  return { hud, texture, ctx }
}

describe('DiegeticHUD radar sweep', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps redrawing and flagging the texture at 15Hz with a completely static state', () => {
    const { hud, texture, ctx } = makeHud()
    const fillText = ctx.fillText as ReturnType<typeof vi.fn>

    let redraws = 0
    const dt = 1 / 15
    for (let frame = 0; frame < 5; frame++) {
      const versionBefore = texture.version
      hud.update(STATIC_STATE, dt)
      if (texture.version > versionBefore) redraws++
    }

    // O sweep é fonte de dirty própria: um redraw por intervalo de 1/15s,
    // mesmo com shield/energy/score/wave/contacts inalterados.
    expect(redraws).toBe(5)
    expect(fillText).toHaveBeenCalled()
    hud.dispose()
  })

  it('stays idle when both state and sweep are frozen (dt = 0)', () => {
    const { hud, texture } = makeHud()
    hud.update(STATIC_STATE, 1 / 15) // desenho inicial
    const versionAfterFirst = texture.version

    for (let frame = 0; frame < 5; frame++) hud.update(STATIC_STATE, 0)

    // Sem avanço de sweep e sem mudança de estado, o throttle continua valendo.
    expect(texture.version).toBe(versionAfterFirst)
    hud.dispose()
  })
})
