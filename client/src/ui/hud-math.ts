/**
 * Matemática pura do HUD diegético — sem Three.js, DOM ou WebXR (spec M2 §4.4).
 *
 * Todas as funções aceitam um objeto `out` opcional para que o hot-loop possa
 * reutilizar buffers e não alocar por frame. Quando `out` é omitido (ex.: em
 * testes) um objeto novo é retornado — comportamento puro e conveniente.
 */

/** Vetor mínimo consumido pelas projeções (compatível com THREE.Vector3). */
export interface Vec3Like {
  x: number
  y: number
  z: number
}

/** Alvo de contato em espaço mundo (ou nave, quando a nave está na origem). */
export interface Contact {
  position: Vec3Like
}

/** Estado exibido no HUD — mock em M2, substituível por estado real depois. */
export interface HudState {
  /** Escudo normalizado 0..1. */
  shield: number
  /** Energia normalizada 0..1. */
  energy: number
  score: number
  wave: number
  contacts: readonly Contact[]
}

/** Ponto projetado no radar 2D; `depth` preserva a distância adiante da nave. */
export interface RadarPoint {
  x: number
  y: number
  depth: number
}

/** Resultado de um pip radial ao redor da retícula. */
export interface PipResult {
  show: boolean
  x: number
  y: number
  rot: number
}

/** Limita `value` ao intervalo [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Envolve um ângulo (radianos) para o intervalo [-PI, PI]. */
export function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI)
  if (a > Math.PI) a -= 2 * Math.PI
  else if (a < -Math.PI) a += 2 * Math.PI
  return a
}

/**
 * Radar 3D simplificado em visão de cima: eixo x -> x, eixo z -> y (com -z
 * "frente" apontando para cima). Pontos além do alcance são clampados à borda
 * do círculo; `depth` mantém o z original para ordenação/tamanho do blip.
 */
export function projectToRadar(
  localPos: Vec3Like,
  radarRadius: number,
  out: RadarPoint = { x: 0, y: 0, depth: 0 },
): RadarPoint {
  const radius = Math.max(0, radarRadius)
  let x = localPos.x
  // `-0` não é desejável como coordenada de blip; normaliza z === 0 para +0.
  let y = localPos.z === 0 ? 0 : -localPos.z
  const dist = Math.hypot(x, y)
  if (dist > radius && dist > 0) {
    const scale = radius / dist
    x *= scale
    y *= scale
  }
  out.x = x
  out.y = y
  out.depth = localPos.z
  return out
}

/**
 * Calcula a seta radial para um ameaça fora do FOV. `angle` é o ângulo no
 * plano da tela (radianos); x/y ficam no círculo unitário e `rot` aponta para
 * fora. Pips invisíveis são zerados para não "vazar" transforms antigos.
 */
export function computePip(
  angle: number,
  visible: boolean,
  out: PipResult = { show: false, x: 0, y: 0, rot: 0 },
): PipResult {
  if (!visible) {
    out.show = false
    out.x = 0
    out.y = 0
    out.rot = 0
    return out
  }
  const a = normalizeAngle(angle)
  out.show = true
  out.x = Math.cos(a)
  out.y = Math.sin(a)
  out.rot = a
  return out
}

/** Dirty-check/throttle: pronto para redesenhar quando `accumulated + dt >= interval`. */
export function shouldUpdateHud(accumulated: number, dt: number, interval: number): boolean {
  return accumulated + dt >= interval
}
