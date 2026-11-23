export const PLAYER_NAME_COOKIE = 'asteroids_player_name'
export const PLAYER_TOKEN_STORAGE_KEY = 'asteroids_player_token_v1'

const DEFAULT_NAME_MAX_LENGTH = 32
const DEFAULT_COOKIE_MAX_AGE_DAYS = 365

export interface CookieAdapter {
  get(name: string): string | null
  set(name: string, value: string, maxAgeDays?: number): void
}

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

class BrowserCookieAdapter implements CookieAdapter {
  get(name: string): string | null {
    try {
      if (typeof document === 'undefined') return null
      const prefix = `${encodeURIComponent(name)}=`
      const parts = document.cookie ? document.cookie.split(';') : []
      for (const part of parts) {
        const trimmed = part.trim()
        if (trimmed.startsWith(prefix)) {
          const raw = trimmed.slice(prefix.length)
          try {
            return decodeURIComponent(raw)
          } catch {
            return raw
          }
        }
      }
      return null
    } catch {
      return null
    }
  }

  set(name: string, value: string, maxAgeDays = DEFAULT_COOKIE_MAX_AGE_DAYS): void {
    try {
      if (typeof document === 'undefined') return
      const maxAge = Math.max(0, Math.floor(maxAgeDays * 24 * 60 * 60))
      const encodedName = encodeURIComponent(name)
      const encodedValue = encodeURIComponent(value)
      document.cookie = `${encodedName}=${encodedValue}; max-age=${maxAge}; path=/; samesite=lax`
    } catch {
      // ignore cookie access failures in restricted environments
    }
  }
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

const defaultCookieAdapter = new BrowserCookieAdapter()
const defaultStorageAdapter = new BrowserStorageAdapter()

export function sanitizePlayerName(name: string): string {
  return name.trim().slice(0, DEFAULT_NAME_MAX_LENGTH)
}

export function readPlayerName(cookies: CookieAdapter = defaultCookieAdapter): string {
  const raw = cookies.get(PLAYER_NAME_COOKIE)
  if (typeof raw !== 'string') return ''
  return sanitizePlayerName(raw)
}

export function writePlayerName(name: string, cookies: CookieAdapter = defaultCookieAdapter): void {
  const clean = sanitizePlayerName(name)
  cookies.set(PLAYER_NAME_COOKIE, clean, DEFAULT_COOKIE_MAX_AGE_DAYS)
}

export function readPlayerToken(storage: StorageAdapter = defaultStorageAdapter): string | null {
  const raw = storage.getItem(PLAYER_TOKEN_STORAGE_KEY)
  if (typeof raw !== 'string') return null
  const token = raw.trim()
  return token.length > 0 ? token : null
}

export function writePlayerToken(token: string, storage: StorageAdapter = defaultStorageAdapter): void {
  const clean = token.trim()
  if (clean.length === 0) return
  storage.setItem(PLAYER_TOKEN_STORAGE_KEY, clean)
}

export function clearPlayerToken(storage: StorageAdapter = defaultStorageAdapter): void {
  storage.removeItem(PLAYER_TOKEN_STORAGE_KEY)
}
