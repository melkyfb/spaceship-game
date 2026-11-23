import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { AssetLoader } from '../../src/assets/AssetLoader'

function makeGltf() {
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()))
  return { scene, scenes: [scene], animations: [], cameras: [], asset: { version: '2.0' } } as any
}

describe('AssetLoader', () => {
  it('loads, caches, and clones by url', async () => {
    const loadAsync = vi.fn(async () => makeGltf())
    const loader = new AssetLoader({ createLoader: () => ({ loadAsync }) as any })
    const a = await loader.load('/assets/models/ships/player_ship.glb')
    const b = await loader.load('/assets/models/ships/player_ship.glb')
    expect(loadAsync).toHaveBeenCalledTimes(1)
    expect(a).not.toBe(b)
    expect(a).toBeInstanceOf(THREE.Group)
  })

  it('returns null on failure', async () => {
    const loadAsync = vi.fn(async () => { throw new Error('boom') })
    const loader = new AssetLoader({ createLoader: () => ({ loadAsync }) as any })
    await expect(loader.load('/missing.glb')).resolves.toBeNull()
  })
})
