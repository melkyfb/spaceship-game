export interface QuatLike {
  x: number
  y: number
  z: number
  w: number
}

const DEG_TO_RAD = Math.PI / 180

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/**
 * Converte orientação de dispositivo (graus) para quatérnio usando ordem Euler YXZ.
 * alpha = rotação em Y (yaw), beta = rotação em X (pitch), gamma = rotação em Z (roll).
 * Escreve em `out` e o retorna para evitar alocações no hot path.
 */
export function deviceOrientationToQuaternionYXZ(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  out: QuatLike,
): QuatLike {
  const a = finiteOrZero(alphaDeg) * DEG_TO_RAD
  const b = finiteOrZero(betaDeg) * DEG_TO_RAD
  const g = finiteOrZero(gammaDeg) * DEG_TO_RAD

  const halfA = a * 0.5
  const halfB = b * 0.5
  const halfG = g * 0.5

  const cy = Math.cos(halfA)
  const sy = Math.sin(halfA)
  const cx = Math.cos(halfB)
  const sx = Math.sin(halfB)
  const cz = Math.cos(halfG)
  const sz = Math.sin(halfG)

  // Intrinsic YXZ: q = qY * qX * qZ
  out.x = cy * sx * cz + sy * cx * sz
  out.y = sy * cx * cz - cy * sx * sz
  out.z = cy * cx * sz - sy * sx * cz
  out.w = cy * cx * cz + sy * sx * sz
  return out
}

/** Calibra eixo de gamepad: deadzone radial simples em eixo 1D, inversão e clamp. */
export function applyGamepadAxisCalibration(
  value: number,
  deadzone = 0.15,
  inverted = false,
): number {
  let v = Number.isFinite(value) ? value : 0
  if (inverted) v = -v
  const dz = Number.isFinite(deadzone) ? Math.max(0, Math.min(deadzone, 1)) : 0.15
  const av = Math.abs(v)
  if (av <= dz || dz >= 1) return 0
  const sign = v < 0 ? -1 : 1
  const scaled = (Math.min(av, 1) - dz) / (1 - dz)
  return sign * scaled
}
