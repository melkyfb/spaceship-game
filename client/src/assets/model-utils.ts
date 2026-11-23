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

export function normalizeObjectToRadius(obj: THREE.Object3D, targetRadius: number): void {
  const box = new THREE.Box3().setFromObject(obj)
  const sphere = new THREE.Sphere()
  box.getBoundingSphere(sphere)
  const r = sphere.radius
  if (r > 1e-6 && targetRadius > 0) obj.scale.multiplyScalar(targetRadius / r)
}
