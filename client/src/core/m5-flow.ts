export interface KillerCameraEventLike {
  killerKind?: 'ENEMY' | 'PLAYER' | 'ASTEROID' | 'UNKNOWN'
  killerId?: string | number
  killerPos?: readonly [number, number, number]
  pos?: readonly [number, number, number]
}

export interface KillerCameraEntityLike {
  id: string | number
  kind: 'ENEMY' | 'PLAYER' | 'ASTEROID'
  pos: readonly [number, number, number]
  alive: boolean
}

export type KillerCameraTarget =
  | { kind: 'entity'; entityKind: 'ENEMY' | 'PLAYER' | 'ASTEROID'; id: string | number }
  | { kind: 'point'; pos: [number, number, number] }

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizePos(pos: readonly [number, number, number] | undefined): [number, number, number] {
  if (pos === undefined) return [0, 0, 0]
  return [finiteOr(pos[0], 0), finiteOr(pos[1], 0), finiteOr(pos[2], 0)]
}

export function respawnCountdownSec(delaySec: number, elapsedSec: number): number {
  const delay = finiteOr(delaySec, 0)
  if (delay <= 0) return 0
  const elapsed = finiteOr(elapsedSec, 0)
  const remaining = delay - elapsed
  return remaining > 0 ? remaining : 0
}

export function isRespawnReady(delaySec: number, elapsedSec: number): boolean {
  const delay = finiteOr(delaySec, 0)
  if (delay <= 0) return true
  const elapsed = finiteOr(elapsedSec, 0)
  return elapsed >= delay
}

export function shouldRecordScore(score: number): boolean {
  return typeof score === 'number' && Number.isFinite(score) && score > 0
}

export function selectKillerCameraTarget(
  event: KillerCameraEventLike,
  entities: readonly KillerCameraEntityLike[],
): KillerCameraTarget {
  const killerKind = event.killerKind ?? 'UNKNOWN'
  const killerId = event.killerId
  const canFollowEntity = killerKind === 'ENEMY' || killerKind === 'PLAYER'

  if (canFollowEntity && killerId !== undefined) {
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (entity === undefined) continue
      if (entity.id !== killerId) continue
      if (entity.kind !== killerKind) continue
      if (entity.alive) {
        return { kind: 'entity', entityKind: entity.kind, id: entity.id }
      }
      break
    }
  }

  const fallbackPos = event.killerPos ?? event.pos
  return { kind: 'point', pos: normalizePos(fallbackPos) }
}
