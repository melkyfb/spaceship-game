import { WAVE_SPAWN_CONFIG, WAVE_SPAWN_COSTS } from '../constants'
import { spawnAsteroidInShell, type Rng, type SpawnPlayerLike } from './spawn'

export type SpawnKind = 'ASTEROID_LARGE' | 'SCOUT' | 'SCAVENGER' | 'BRUISER'

export interface SpawnPlanEntry {
  kind: SpawnKind
  pos: [number, number, number]
}

export interface SpawnPlan {
  wave: number
  budget: number
  spent: number
  entries: SpawnPlanEntry[]
}

interface SpawnDef {
  kind: SpawnKind
  cost: number
}

// Stable order for deterministic selection among affordable options.
const SPAWN_DEFS: readonly SpawnDef[] = [
  { kind: 'SCAVENGER', cost: WAVE_SPAWN_COSTS.SCAVENGER },
  { kind: 'SCOUT', cost: WAVE_SPAWN_COSTS.SCOUT },
  { kind: 'ASTEROID_LARGE', cost: WAVE_SPAWN_COSTS.LARGE },
  { kind: 'BRUISER', cost: WAVE_SPAWN_COSTS.BRUISER },
]

export function computeWaveBudget(wave: number, playerCount: number): number {
  const w = Number.isFinite(wave) ? Math.max(0, Math.trunc(wave)) : 0
  const p = Number.isFinite(playerCount) ? Math.max(0, Math.trunc(playerCount)) : 0
  return 10 + 4 * w + 2 * p
}

function isEnemyKind(kind: SpawnKind): boolean {
  return kind === 'SCOUT' || kind === 'SCAVENGER' || kind === 'BRUISER'
}

export class WaveManager {
  private _currentWave = 0
  private _enemiesRemaining = 0

  get currentWave(): number {
    return this._currentWave
  }

  planWave(
    wave: number,
    playerCount: number,
    players: readonly SpawnPlayerLike[],
    rng: Rng,
  ): SpawnPlan {
    const budget = computeWaveBudget(wave, playerCount)
    const entries: SpawnPlanEntry[] = []
    let spent = 0

    // Reuse a small scratch list to avoid per-iteration allocations.
    const affordable: SpawnDef[] = []

    while (spent < budget) {
      affordable.length = 0
      for (let i = 0; i < SPAWN_DEFS.length; i++) {
        const def = SPAWN_DEFS[i]
        if (def !== undefined && def.cost <= budget - spent) affordable.push(def)
      }
      if (affordable.length === 0) break

      let placed = false
      while (affordable.length > 0) {
        const pickIdx = Math.floor(clamp01(rng()) * affordable.length)
        const idx = pickIdx < affordable.length ? pickIdx : affordable.length - 1
        const picked = affordable[idx]
        if (picked === undefined) break

        const pos = spawnAsteroidInShell(
          rng,
          WAVE_SPAWN_CONFIG.MIN_R,
          WAVE_SPAWN_CONFIG.MAX_R,
          players,
          WAVE_SPAWN_CONFIG.MIN_PLAYER_DIST,
        )
        if (pos !== null) {
          entries.push({ kind: picked.kind, pos })
          spent += picked.cost
          placed = true
          break
        }

        // Remove failed kind and try another affordable option deterministically.
        affordable[idx] = affordable[affordable.length - 1]!
        affordable.length -= 1
      }

      if (!placed) break
    }

    this._currentWave = wave
    this._enemiesRemaining = 0
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      if (e !== undefined && isEnemyKind(e.kind)) this._enemiesRemaining += 1
    }

    return { wave, budget, spent, entries }
  }

  onEnemyKilled(): void {
    if (this._enemiesRemaining > 0) this._enemiesRemaining -= 1
  }

  isWaveClear(): boolean {
    return this._enemiesRemaining <= 0
  }

  advance(): number {
    this._currentWave += 1
    this._enemiesRemaining = 0
    return this._currentWave
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}
