import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { OffscreenPips } from '../src/ui/OffscreenPips'
import type { Contact } from '../src/ui/hud-math'

/** Câmera na origem olhando -z; sem DOM/WebGL necessários. */
function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 1500)
  camera.updateMatrixWorld()
  return camera
}

describe('OffscreenPips FOV detection', () => {
  it('hides in-FOV contacts and shows offscreen ones around the reticle', () => {
    const group = new THREE.Group()
    const pips = new OffscreenPips(group)
    const camera = makeCamera()
    const contacts: Contact[] = [
      { position: { x: 0, y: 0, z: -100 } }, // centro, dentro do FOV
      { position: { x: 200, y: 0, z: -10 } }, // muito à direita, fora do FOV
      { position: { x: 0, y: 0, z: 100 } }, // atrás da câmera
      { position: { x: 20, y: 5, z: -100 } }, // dentro do FOV (excêntrico)
      { position: { x: 0, y: 80, z: -100 } }, // acima, fora do FOV vertical
    ]

    pips.update(contacts, camera, 0)
    const meshes = group.children as THREE.Mesh[]

    expect(meshes[0]?.visible).toBe(false)
    expect(meshes[1]?.visible).toBe(true)
    expect(meshes[2]?.visible).toBe(true)
    expect(meshes[3]?.visible).toBe(false)
    expect(meshes[4]?.visible).toBe(true)

    // Direita -> pip à direita; atrás -> pip à esquerda; acima -> pip acima.
    expect(meshes[1]!.position.x).toBeGreaterThan(0)
    expect(Math.abs(meshes[1]!.position.y)).toBeLessThan(0.001)
    expect(meshes[2]!.position.x).toBeLessThan(0)
    expect(meshes[4]!.position.y).toBeGreaterThan(0)

    // Pool não utilizado permanece oculto.
    expect(meshes[5]?.visible).toBe(false)
    pips.dispose()
  })

  it('keeps pips hidden when every contact is inside the FOV', () => {
    const group = new THREE.Group()
    const pips = new OffscreenPips(group)
    const camera = makeCamera()
    const contacts: Contact[] = [
      { position: { x: 0, y: 0, z: -60 } },
      { position: { x: 10, y: 5, z: -100 } },
    ]

    pips.update(contacts, camera, 1 / 60)
    for (const child of group.children) {
      expect((child as THREE.Mesh).visible).toBe(false)
    }
    pips.dispose()
  })
})
