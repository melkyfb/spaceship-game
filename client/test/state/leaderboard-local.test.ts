import { describe, expect, it } from 'vitest'
import {
  LOCAL_LEADERBOARD_KEY,
  loadLocalLeaderboard,
  recordLocalScore,
  type LocalLeaderboardEntry,
  type StorageAdapter,
} from '../../src/state/leaderboard-local'

function memoryStorage(): StorageAdapter & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem(key: string) {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      data.set(key, value)
    },
    removeItem(key: string) {
      data.delete(key)
    },
  }
}

function entry(name: string, score: number, wave: number, createdAt?: string): LocalLeaderboardEntry {
  return createdAt === undefined ? { name, score, wave } : { name, score, wave, createdAt }
}

describe('leaderboard-local', () => {
  it('exposes the spec localStorage key', () => {
    expect(LOCAL_LEADERBOARD_KEY).toBe('asteroids_leaderboard_local_v1')
  })

  it('returns empty array when nothing is stored', () => {
    const storage = memoryStorage()
    expect(loadLocalLeaderboard(storage)).toEqual([])
  })

  it('records scores, sorts descending, and computes rank from list', () => {
    const storage = memoryStorage()
    recordLocalScore(entry('Alice', 100, 2, '2026-01-01T00:00:00.000Z'), storage)
    const ranked = recordLocalScore(entry('Bob', 250, 4, '2026-01-02T00:00:00.000Z'), storage)

    expect(ranked).toEqual([
      { rank: 1, name: 'Bob', score: 250, wave: 4, createdAt: '2026-01-02T00:00:00.000Z' },
      { rank: 2, name: 'Alice', score: 100, wave: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
    expect(loadLocalLeaderboard(storage)).toEqual(ranked)
  })

  it('keeps only the top 10 entries', () => {
    const storage = memoryStorage()
    for (let i = 1; i <= 12; i++) {
      recordLocalScore(entry(`P${i}`, i * 10, i, `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`), storage)
    }
    const ranked = loadLocalLeaderboard(storage)

    expect(ranked).toHaveLength(10)
    expect(ranked[0]).toMatchObject({ rank: 1, name: 'P12', score: 120 })
    expect(ranked[9]).toMatchObject({ rank: 10, name: 'P3', score: 30 })
  })

  it('ignores corrupt storage content', () => {
    const storage = memoryStorage()
    storage.setItem(LOCAL_LEADERBOARD_KEY, '{not json')
    expect(loadLocalLeaderboard(storage)).toEqual([])
  })

  it('ignores invalid entries when loading', () => {
    const storage = memoryStorage()
    storage.setItem(
      LOCAL_LEADERBOARD_KEY,
      JSON.stringify([
        { name: 'Ok', score: 10, wave: 1, createdAt: '2026-01-01T00:00:00.000Z' },
        { name: '', score: 20, wave: 1 },
        { name: 'Bad', score: 'x', wave: 1 },
        null,
      ]),
    )
    expect(loadLocalLeaderboard(storage)).toEqual([
      { rank: 1, name: 'Ok', score: 10, wave: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    ])
  })
})
