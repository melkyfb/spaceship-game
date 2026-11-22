/** Constantes de render da spec 4.4 / US-06 — sem assets e sem pós-processamento (ADR-04). */

/** Brown-Conrady radial barrel: k1 e k2 da spec (VR Box). */
export const BARREL_K1 = 0.22
export const BARREL_K2 = 0.24

/** IPD em milímetros: faixa confortável da spec e default razoável. */
export const IPD_MIN_MM = 56
export const IPD_MAX_MM = 74
export const DEFAULT_IPD_MM = 64

/** Limite de devicePixelRatio: teto de performance para mobile e Quest 3. */
export const MAX_DPR = 2

/** WebXR Quest 3: sessão e espaço de referência «local» da spec. */
export const XR_SESSION_MODE = 'immersive-vr'
export const XR_REFERENCE_SPACE_TYPE = 'local'

/** Chaves de persistência simples (localStorage) — substituíveis por M3. */
export const IPD_STORAGE_KEY = 'asteroids.ipdMm'
export const RENDER_MODE_STORAGE_KEY = 'asteroids.renderMode'

/** Mantém qualquer valor de IPD dentro da faixa confortável da spec. */
export function clampIpdMm(mm: number): number {
  if (!Number.isFinite(mm)) return DEFAULT_IPD_MM
  return Math.min(IPD_MAX_MM, Math.max(IPD_MIN_MM, mm))
}
