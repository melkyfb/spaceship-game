import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyGamepadMapping,
  isMappingComplete,
  loadGamepadMapping,
  saveGamepadMapping,
  type GamepadMapping,
} from '../src/input/gamepad-mapping'

function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial))
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
  vi.stubGlobal('localStorage', storage)
  return { store, storage }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('gamepad-mapping', () => {
  it('creates an empty incomplete mapping', () => {
    const mapping = createEmptyGamepadMapping()
    expect(isMappingComplete(mapping)).toBe(false)
  })

  it('reports complete when all required fields are mapped', () => {
    const mapping: GamepadMapping = {
      axes: { thrust: 1, strafeX: 0, yaw: 2, pitch: 3 },
      buttons: { firePrimary: 0, fireSecondary: 1, boost: 2 },
      inverted: { thrust: false, pitch: false },
    }
    expect(isMappingComplete(mapping)).toBe(true)
  })

  it('reports incomplete when any required field is missing', () => {
    const base = createEmptyGamepadMapping()
    expect(isMappingComplete(base)).toBe(false)

    expect(
      isMappingComplete({
        ...base,
        axes: { ...base.axes, thrust: 1 },
      }),
    ).toBe(false)

    expect(
      isMappingComplete({
        axes: { thrust: 1, strafeX: 0, yaw: 2, pitch: 3 },
        buttons: { firePrimary: 0, fireSecondary: -1, boost: 2 },
        inverted: { thrust: false, pitch: false },
      }),
    ).toBe(false)
  })

  it('saves and loads mapping from localStorage', () => {
    const { store } = stubLocalStorage()
    const mapping: GamepadMapping = {
      axes: { thrust: 1, strafeX: 0, yaw: 2, pitch: 5 },
      buttons: { firePrimary: 7, fireSecondary: 6, boost: 0 },
      inverted: { thrust: true, pitch: false },
    }

    saveGamepadMapping(mapping)

    const raw = store.get('asteroids.vrbox.gamepadMapping')
    expect(raw).toBeTypeOf('string')

    const loaded = loadGamepadMapping()
    expect(loaded).toEqual(mapping)
  })

  it('returns empty mapping when storage is missing or invalid', () => {
    stubLocalStorage()
    expect(isMappingComplete(loadGamepadMapping())).toBe(false)

    stubLocalStorage({ 'asteroids.vrbox.gamepadMapping': '{not-json' })
    expect(isMappingComplete(loadGamepadMapping())).toBe(false)

    stubLocalStorage({
      'asteroids.vrbox.gamepadMapping': JSON.stringify({ axes: { thrust: 'bad' } }),
    })
    expect(isMappingComplete(loadGamepadMapping())).toBe(false)
  })

  it('sanitizes partially valid stored mappings', () => {
    stubLocalStorage({
      'asteroids.vrbox.gamepadMapping': JSON.stringify({
        axes: { thrust: 1, strafeX: 0, yaw: 2, pitch: 3, extra: 9 },
        buttons: { firePrimary: 4, fireSecondary: 5, boost: 6 },
        inverted: { thrust: true, pitch: 1 },
      }),
    })

    const loaded = loadGamepadMapping()
    expect(loaded.axes).toEqual({ thrust: 1, strafeX: 0, yaw: 2, pitch: 3 })
    expect(loaded.buttons).toEqual({ firePrimary: 4, fireSecondary: 5, boost: 6 })
    expect(loaded.inverted.thrust).toBe(true)
    expect(loaded.inverted.pitch).toBe(false)
    expect(isMappingComplete(loaded)).toBe(true)
  })
})
