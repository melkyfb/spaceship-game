export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value <= -1) return -1
  if (value >= 1) return 1
  return value === 0 ? 0 : value
}

export function applyRadialDeadzone(
  x: number,
  y: number,
  deadzone = 0.15,
  out?: { x: number; y: number },
): { x: number; y: number } {
  const ax = Number.isFinite(x) ? x : 0
  const ay = Number.isFinite(y) ? y : 0
  const dz = Number.isFinite(deadzone) ? Math.max(0, Math.min(deadzone, 1)) : 0.15
  const mag = Math.hypot(ax, ay)
  const target = out ?? { x: 0, y: 0 }

  if (mag <= dz || mag === 0 || dz >= 1) {
    target.x = 0
    target.y = 0
    return target
  }

  const clampedMag = Math.min(mag, 1)
  const scaled = (clampedMag - dz) / (1 - dz)
  const norm = scaled / mag
  target.x = ax * norm
  target.y = ay * norm
  return target
}

export function applyResponseCurve(value: number, exponent = 1.6): number {
  if (!Number.isFinite(value)) return 0
  if (value === 0) return 0
  return Math.sign(value) * Math.pow(Math.abs(value), exponent)
}
