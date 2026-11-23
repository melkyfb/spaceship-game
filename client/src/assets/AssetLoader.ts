import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { cloneGltfScene } from './model-utils'

export interface AssetLoaderOptions {
  createLoader?: () => Pick<GLTFLoader, 'loadAsync'>
  timeoutMs?: number
}

export class AssetLoader {
  private readonly createLoader: () => Pick<GLTFLoader, 'loadAsync'>
  private readonly timeoutMs: number
  private readonly cache = new Map<string, Promise<GLTF | null>>()

  constructor(opts: AssetLoaderOptions = {}) {
    this.createLoader = opts.createLoader ?? (() => new GLTFLoader())
    this.timeoutMs = opts.timeoutMs ?? 15000
  }

  async preload(urls: readonly string[]): Promise<void> {
    await Promise.all(urls.map((u) => this.loadGltf(u)))
  }

  async load(url: string): Promise<THREE.Group | null> {
    const gltf = await this.loadGltf(url)
    return gltf ? cloneGltfScene(gltf) : null
  }

  getCached(url: string): THREE.Group | null {
    const p = this.cache.get(url)
    // only sync if already resolved; callers should prefer preload+load
    return null
  }

  private loadGltf(url: string): Promise<GLTF | null> {
    const existing = this.cache.get(url)
    if (existing) return existing
    const p = this.doLoad(url)
    this.cache.set(url, p)
    return p
  }

  private async doLoad(url: string): Promise<GLTF | null> {
    const loader = this.createLoader()
    try {
      const gltf = await Promise.race([
        loader.loadAsync(url),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout ${url}`)), this.timeoutMs)),
      ])
      return gltf as GLTF
    } catch (err) {
      console.warn('[AssetLoader] failed', url, err)
      return null
    }
  }
}
