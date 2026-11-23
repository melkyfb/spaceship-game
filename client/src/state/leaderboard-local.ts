export const LOCAL_LEADERBOARD_KEY = 'asteroids_leaderboard_local_v1'
export const LOCAL_LEADERBOARD_LIMIT = 10

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface LocalLeaderboardEntry {
  name: string
  score: number
  wave: number
  createdAt?: string
}

export interface RankedLocalLeaderboardEntry {
  rank: number
  name: string
  score: number
  wave: number
  createdAt?: string
}

class BrowserStorageAdapter implements StorageAdapter {
  getItem(key: string): string | null {
    try {
      if (typeof localStorage === 'undefined') return null
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(key, value)
    } catch {
      // ignore quota/private mode failures
    }
  }

  removeItem(key: string): void {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.removeItem(key)
    } catch {
      // ignore quota/private mode failures
    }
  }
}

const defaultStorageAdapter = new BrowserStorageAdapter()

function normalizeEntry(value: unknown): LocalLeaderboardEntry | null {
  if (typeof value !== 'object' || value === null) return null
  const rec = value as Record<string, unknown>
  const name = typeof rec.name === 'string' ? rec.name.trim() : ''
  if (name.length === 0) return null

  const score = rec.score
  const wave = rec.wave
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) return null
  if (typeof wave !== 'number' || !Number.isFinite(wave) || wave < 0) return null

  const normalized: LocalLeaderboardEntry = {
    name,
    score: Math.floor(score),
    wave: Math.floor(wave),
  }
  if (typeof rec.createdAt === 'string' && rec.createdAt.trim().length > 0) {
    normalized.createdAt = rec.createdAt
  }
  return normalized
}

function compareEntries(a: LocalLeaderboardEntry, b: LocalLeaderboardEntry): number {
  if (b.score !== a.score) return b.score - a.score
  if (b.wave !== a.wave) return b.wave - a.wave
  const aTime = a.createdAt ?? ''
  const bTime = b.createdAt ?? ''
  if (bTime !== aTime) return bTime < aTime ? -1 : 1
  return a.name.localeCompare(b.name)
}

function rankEntries(entries: LocalLeaderboardEntry[]): RankedLocalLeaderboardEntry[] {
  return entries.map((entry, index) => ({
    rank: index + 1,
    name: entry.name,
    score: entry.score,
    wave: entry.wave,
    ...(entry.createdAt !== undefined ? { createdAt: entry.createdAt } : {}),
  }))
}

function persist(entries: LocalLeaderboardEntry[], storage: StorageAdapter): void {
  try {
    storage.setItem(LOCAL_LEADERBOARD_KEY, JSON.stringify(entries))
  } catch {
    // ignore serialization/storage failures
  }
}

export function loadLocalLeaderboard(storage: StorageAdapter = defaultStorageAdapter): RankedLocalLeaderboardEntry[] {
  let raw: string | null = null
  try {
    raw = storage.getItem(LOCAL_LEADERBOARD_KEY)
  } catch {
    return []
  }
  if (typeof raw !== 'string' || raw.length === 0) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const entries: LocalLeaderboardEntry[] = []
  for (const item of parsed) {
    const normalized = normalizeEntry(item)
    if (normalized) entries.push(normalized)
  }
  entries.sort(compareEntries)
  return rankEntries(entries.slice(0, LOCAL_LEADERBOARD_LIMIT))
}

export function recordLocalScore(
  entry: LocalLeaderboardEntry,
  storage: StorageAdapter = defaultStorageAdapter,
): RankedLocalLeaderboardEntry[] {
  const normalized = normalizeEntry(entry)
  const current = loadLocalLeaderboard(storage).map(({ rank: _rank, ...rest }) => rest)
  if (normalized) current.push(normalized)
  current.sort(compareEntries)
  const top = current.slice(0, LOCAL_LEADERBOARD_LIMIT)
  persist(top, storage)
  return rankEntries(top)
}
