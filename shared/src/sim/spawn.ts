import { ASTEROID_TIERS } from '../constants'
import { isFiniteNumber } from '../math'
import type { AsteroidSize, AsteroidState, ShipState } from '../types'
import type { IdSeq } from './ids'

export type Rng = () => number

export type Vec3Tuple = [number, number, number]

export interface SpawnPlayerLike {
  pos: readonly [number, number, number] | Float32Array
  alive: boolean
}

function clamp01(value: number): number {
  if (!isFiniteNumber(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function finiteOr(value: number, fallback: number): number {
  return isFiniteNumber(value) ? value : fallback
}

function distSqToPlayer(pos: readonly [number, number, number] | Float32Array, player: SpawnPlayerLike): number {
  const px = finiteOr(pos[0] ?? 0, 0)
  const py = finiteOr(pos[1] ?? 0, 0)
  const pz = finiteOr(pos[2] ?? 0, 0)
  const ox = finiteOr(player.pos[0] ?? 0, 0)
  const oy = finiteOr(player.pos[1] ?? 0, 0)
  const oz = finiteOr(player.pos[2] ?? 0, 0)
  const dx = px - ox
  const dy = py - oy
  const dz = pz - oz
  return dx * dx + dy * dy + dz * dz
}

/** Distância segura: true quando pos está a >= minDist de qualquer jogador vivo. */
export function isSafeSpawn(
  pos: readonly [number, number, number] | Float32Array,
  players: readonly SpawnPlayerLike[],
  minDist: number,
): boolean {
  const minD = finiteOr(minDist, 0)
  const minSq = minD * minD
  for (let i = 0; i < players.length; i++) {
    const player = players[i]
    if (player === undefined || player.alive !== true) continue
    if (distSqToPlayer(pos, player) < minSq) return false
  }
  return true
}

/**
 * Gera ponto aleatório determinístico em casca esférica [minR, maxR],
 * rejeitando pontos a menos de minDist de jogadores vivos.
 * Retorna null se não encontrar posição segura em maxAttempts.
 */
export function spawnAsteroidInShell(
  rng: Rng,
  minR: number,
  maxR: number,
  players: readonly SpawnPlayerLike[],
  minDist: number,
  maxAttempts = 32,
): Vec3Tuple | null {
  const lo = Math.max(0, finiteOr(minR, 0))
  const hi = Math.max(lo, finiteOr(maxR, lo))
  const attempts = Math.max(1, Math.trunc(finiteOr(maxAttempts, 32)))

  const lo3 = lo * lo * lo
  const hi3 = hi * hi * hi

  for (let attempt = 0; attempt < attempts; attempt++) {
    // Direção uniforme na esfera.
    const u = clamp01(rng()) * 2 - 1 // cos(theta) em [-1,1]
    const phi = clamp01(rng()) * Math.PI * 2
    const sinTheta = Math.sqrt(Math.max(0, 1 - u * u))
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    // Raio uniforme em volume na casca.
    const t = clamp01(rng())
    const radius = Math.cbrt(lo3 + (hi3 - lo3) * t)

    const pos: Vec3Tuple = [
      radius * sinTheta * cosPhi,
      radius * u,
      radius * sinTheta * sinPhi,
    ]

    if (isSafeSpawn(pos, players, minDist)) return pos
  }

  return null
}

function nextTierOf(size: AsteroidSize): AsteroidSize | null {
  return ASTEROID_TIERS[size].nextTier
}

/**
 * Fragmenta asteroide seguindo ASTEROID_TIERS. Determinístico: usa apenas
 * idSeq e rng injetado. Sem Math.random().
 */
export function fragmentAsteroid(
  asteroid: AsteroidState,
  idSeq: IdSeq,
  rng: Rng,
): AsteroidState[] {
  const tier = ASTEROID_TIERS[asteroid.size]
  const count = tier.children
  const nextSize = nextTierOf(asteroid.size)
  if (count <= 0 || nextSize === null) return []

  const nextTier = ASTEROID_TIERS[nextSize]
  const out: AsteroidState[] = []
  const px = finiteOr(asteroid.pos[0] ?? 0, 0)
  const py = finiteOr(asteroid.pos[1] ?? 0, 0)
  const pz = finiteOr(asteroid.pos[2] ?? 0, 0)
  const pvx = finiteOr(asteroid.vel[0] ?? 0, 0)
  const pvy = finiteOr(asteroid.vel[1] ?? 0, 0)
  const pvz = finiteOr(asteroid.vel[2] ?? 0, 0)

  // Base de espalhamento razoável: proporcional ao raio do pai, limitado.
  const parentRadius = finiteOr(tier.radius, 1)
  const spreadPos = Math.max(0.5, parentRadius * 0.35)
  const spreadVel = Math.max(1, nextTier.speed * 0.35)

  for (let i = 0; i < count; i++) {
    // Direção pseudo-aleatória determinística via rng.
    const du = clamp01(rng()) * 2 - 1
    const dphi = clamp01(rng()) * Math.PI * 2
    const dsin = Math.sqrt(Math.max(0, 1 - du * du))
    const dcosPhi = Math.cos(dphi)
    const dsinPhi = Math.sin(dphi)
    const dx = dsin * dcosPhi
    const dy = du
    const dz = dsin * dsinPhi

    const posJitter = 0.5 + clamp01(rng()) * 0.5 // [0.5,1.0]
    const velJitter = 0.75 + clamp01(rng()) * 0.5 // [0.75,1.25]

    const child: AsteroidState = {
      id: idSeq.next(),
      pos: [
        px + dx * spreadPos * posJitter,
        py + dy * spreadPos * posJitter,
        pz + dz * spreadPos * posJitter,
      ],
      vel: [
        pvx + dx * spreadVel * velJitter,
        pvy + dy * spreadVel * velJitter,
        pvz + dz * spreadVel * velJitter,
      ],
      rot: [0, 0, 0, 1],
      angVel: [
        (clamp01(rng()) * 2 - 1) * 1.5,
        (clamp01(rng()) * 2 - 1) * 1.5,
        (clamp01(rng()) * 2 - 1) * 1.5,
      ],
      size: nextSize,
      hp: nextTier.hp,
    }
    out.push(child)
  }

  return out
}
