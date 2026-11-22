import * as THREE from 'three'

/** Fixed local seed: the same star pattern on every load, with no external assets. */
const STARFIELD_SEED = 0x5eed1234
const INNER_RADIUS = 300
const OUTER_RADIUS = 1200

/** mulberry32: tiny deterministic PRNG, so no `Math.random` and reproducible output. */
function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Procedural star shell around the origin: one BufferGeometry + one PointsMaterial,
 * no textures and no downloaded assets (ADR-04).
 */
export function createStarfield(count: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const positions = new Float32Array(count * 3)
  const rng = createRng(STARFIELD_SEED)

  for (let i = 0; i < count; i += 1) {
    // Uniform direction on the unit sphere, uniform radius inside the shell.
    const cosTheta = rng() * 2 - 1
    const phi = rng() * Math.PI * 2
    const radius = INNER_RADIUS + rng() * (OUTER_RADIUS - INNER_RADIUS)
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta)

    const offset = i * 3
    positions[offset] = radius * sinTheta * Math.cos(phi)
    positions[offset + 1] = radius * sinTheta * Math.sin(phi)
    positions[offset + 2] = radius * cosTheta
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    sizeAttenuation: false,
    depthWrite: false,
  })

  const stars = new THREE.Points(geometry, material)
  stars.name = 'Starfield'
  stars.frustumCulled = false
  return stars
}
