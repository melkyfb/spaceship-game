export interface GamepadAxisMapping {
  thrust: number
  strafeX: number
  yaw: number
  pitch: number
}

export interface GamepadButtonMapping {
  firePrimary: number
  fireSecondary: number
  boost: number
}

export interface GamepadMapping {
  axes: GamepadAxisMapping
  buttons: GamepadButtonMapping
  inverted: {
    thrust: boolean
    pitch: boolean
  }
}

export const GAMEPAD_MAPPING_STORAGE_KEY = 'asteroids.vrbox.gamepadMapping'

export function createEmptyGamepadMapping(): GamepadMapping {
  return {
    axes: { thrust: -1, strafeX: -1, yaw: -1, pitch: -1 },
    buttons: { firePrimary: -1, fireSecondary: -1, boost: -1 },
    inverted: { thrust: false, pitch: false },
  }
}

function isFiniteIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1
}

function sanitizeIndex(value: unknown): number {
  return isFiniteIndex(value) ? value : -1
}

function sanitizeBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function sanitizeMapping(value: unknown): GamepadMapping {
  const empty = createEmptyGamepadMapping()
  if (!value || typeof value !== 'object') return empty
  const obj = value as Record<string, unknown>
  const axesRaw = (obj.axes && typeof obj.axes === 'object' ? obj.axes : {}) as Record<string, unknown>
  const buttonsRaw = (obj.buttons && typeof obj.buttons === 'object' ? obj.buttons : {}) as Record<
    string,
    unknown
  >
  const invertedRaw = (obj.inverted && typeof obj.inverted === 'object' ? obj.inverted : {}) as Record<
    string,
    unknown
  >

  return {
    axes: {
      thrust: sanitizeIndex(axesRaw.thrust),
      strafeX: sanitizeIndex(axesRaw.strafeX),
      yaw: sanitizeIndex(axesRaw.yaw),
      pitch: sanitizeIndex(axesRaw.pitch),
    },
    buttons: {
      firePrimary: sanitizeIndex(buttonsRaw.firePrimary),
      fireSecondary: sanitizeIndex(buttonsRaw.fireSecondary),
      boost: sanitizeIndex(buttonsRaw.boost),
    },
    inverted: {
      thrust: sanitizeBool(invertedRaw.thrust, false),
      pitch: sanitizeBool(invertedRaw.pitch, false),
    },
  }
}

export function isMappingComplete(mapping: GamepadMapping | null | undefined): boolean {
  if (!mapping) return false
  const a = mapping.axes
  const b = mapping.buttons
  return (
    a.thrust >= 0 &&
    a.strafeX >= 0 &&
    a.yaw >= 0 &&
    a.pitch >= 0 &&
    b.firePrimary >= 0 &&
    b.fireSecondary >= 0 &&
    b.boost >= 0
  )
}

export function loadGamepadMapping(): GamepadMapping {
  try {
    if (typeof localStorage === 'undefined') return createEmptyGamepadMapping()
    const raw = localStorage.getItem(GAMEPAD_MAPPING_STORAGE_KEY)
    if (!raw) return createEmptyGamepadMapping()
    const parsed = JSON.parse(raw) as unknown
    return sanitizeMapping(parsed)
  } catch {
    return createEmptyGamepadMapping()
  }
}

export function saveGamepadMapping(mapping: GamepadMapping): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(GAMEPAD_MAPPING_STORAGE_KEY, JSON.stringify(sanitizeMapping(mapping)))
  } catch {
    // Storage may be unavailable; caller keeps in-memory mapping.
  }
}
