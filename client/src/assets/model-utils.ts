import * as THREE from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

export function cloneGltfScene(gltf: GLTF): THREE.Group {
  const root = gltf.scene.clone(true)
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh) {
      mesh.castShadow = false
      mesh.receiveShadow = false
      mesh.frustumCulled = false
    }
  })
  return root
}

/**
 * Center object bounds at origin and uniformly scale so bounding sphere radius == targetRadius.
 * This enforces the gameplay pivot/origin contract for GLB templates.
 */
export function normalizeObjectToRadius(obj: THREE.Object3D, targetRadius: number): void {
  centerObjectToOrigin(obj)
  const box = new THREE.Box3().setFromObject(obj)
  const sphere = new THREE.Sphere()
  box.getBoundingSphere(sphere)
  const r = sphere.radius
  if (r > 1e-6 && targetRadius > 0) {
    const s = targetRadius / r
    obj.scale.multiplyScalar(s)
    obj.position.multiplyScalar(s)
  }
}

/** Recenter an object so its world-bounds center sits at local origin. */
export function centerObjectToOrigin(obj: THREE.Object3D): void {
  obj.updateWorldMatrix(true, true)
  const box = new THREE.Box3().setFromObject(obj)
  if (box.isEmpty()) return
  const center = new THREE.Vector3()
  box.getCenter(center)
  obj.position.sub(center)
  obj.updateWorldMatrix(true, true)
}

/**
 * Dispose geometries/materials owned by an object graph.
 * Textures are NOT disposed by default because cloned materials often share texture references
 * with their source template; dispose textures only when ownership is exclusive.
 */
export function disposeObjectResources(obj: THREE.Object3D, opts: { textures?: boolean } = {}): void {
  const disposeTextures = opts.textures === true
  const textures = new Set<THREE.Texture>()
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const mat of mats) {
      if (disposeTextures) {
        for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
          if (value instanceof THREE.Texture) textures.add(value)
        }
      }
      mat.dispose()
    }
  })
  if (disposeTextures) {
    for (const tex of textures) tex.dispose()
  }
}
