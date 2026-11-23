import { describe, expect, it } from 'vitest'
import {
  PLAYER_NAME_COOKIE,
  PLAYER_TOKEN_STORAGE_KEY,
  readPlayerName,
  readPlayerToken,
  writePlayerName,
  writePlayerToken,
  type CookieAdapter,
  type StorageAdapter,
} from '../../src/state/player-profile'

function memoryCookie(): CookieAdapter & { jar: Map<string, string> } {
  const jar = new Map<string, string>()
  return {
    jar,
    get(name: string) {
      return jar.get(name) ?? null
    },
    set(name: string, value: string) {
      jar.set(name, value)
    },
  }
}

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

describe('player-profile', () => {
  it('exposes the spec cookie/storage keys', () => {
    expect(PLAYER_NAME_COOKIE).toBe('asteroids_player_name')
    expect(PLAYER_TOKEN_STORAGE_KEY).toBe('asteroids_player_token_v1')
  })

  it('reads empty name when cookie is missing', () => {
    const cookies = memoryCookie()
    expect(readPlayerName(cookies)).toBe('')
  })

  it('writes and reads player name through cookie adapter', () => {
    const cookies = memoryCookie()
    writePlayerName('  Pilot One  ', cookies)
    expect(readPlayerName(cookies)).toBe('Pilot One')
    expect(cookies.jar.get(PLAYER_NAME_COOKIE)).toBe('Pilot One')
  })

  it('returns empty name for blank cookie values', () => {
    const cookies = memoryCookie()
    cookies.set(PLAYER_NAME_COOKIE, '   ')
    expect(readPlayerName(cookies)).toBe('')
  })

  it('reads null token when missing', () => {
    const storage = memoryStorage()
    expect(readPlayerToken(storage)).toBeNull()
  })

  it('writes and reads player token through storage adapter', () => {
    const storage = memoryStorage()
    writePlayerToken('opaque-token-123', storage)
    expect(readPlayerToken(storage)).toBe('opaque-token-123')
    expect(storage.data.get(PLAYER_TOKEN_STORAGE_KEY)).toBe('opaque-token-123')
  })

  it('ignores blank token writes and keeps existing token untouched', () => {
    const storage = memoryStorage()
    writePlayerToken('keep-me', storage)
    writePlayerToken('   ', storage)
    expect(readPlayerToken(storage)).toBe('keep-me')
  })
})
