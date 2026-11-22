import * as THREE from 'three'
import {
  clamp,
  projectToRadar,
  shouldUpdateHud,
  type Contact,
  type HudState,
  type RadarPoint,
} from './hud-math'

const HUD_TEXTURE_WIDTH = 512
const HUD_TEXTURE_HEIGHT = 256
/** Teto de atualização da textura: 15Hz (spec M2 / ADR-04). */
const HUD_INTERVAL = 1 / 15
/** Limite de blips desenhados no radar — também dimensiona o snapshot (pool fixo). */
const MAX_RADAR_CONTACTS = 16

const RADAR_CX = 356
const RADAR_CY = 128
const RADAR_RADIUS = 92
const RADAR_RINGS = [RADAR_RADIUS / 3, (RADAR_RADIUS * 2) / 3]
const SWEEP_RAD_PER_SEC = 1.4

/**
 * HUD diegético desenhado proceduralmente em um canvas 512x256 (ADR-04).
 *
 * A textura só é redesenhada — e `needsUpdate` só é setado — quando algum
 * valor exibido muda OU o sweep avança, E o intervalo de 1/15s já se passou.
 * Assim o radar continua girando mesmo com estado estático. Nenhum objeto é
 * alocado no hot-loop: comparações usam um snapshot Float64Array pré-alocado
 * e a projeção de radar reutiliza um `RadarPoint` pré-alocado.
 */
export class DiegeticHUD {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly texture: THREE.CanvasTexture
  private readonly material: THREE.MeshBasicMaterial
  private readonly originalMap: THREE.Texture | null

  private readonly radarScratch: RadarPoint = { x: 0, y: 0, depth: 0 }
  /** f64 para preservar exatamente as posições (f32 arredonda e marca dirty sempre). */
  private readonly lastContactPositions = new Float64Array(MAX_RADAR_CONTACTS * 3)

  private accumulator = 0
  private sweepAngle = 0
  private dirty = true
  private lastShield = Number.NaN
  private lastEnergy = Number.NaN
  private lastScore = Number.NaN
  private lastWave = Number.NaN
  private lastContactCount = -1

  constructor(mesh: THREE.Mesh) {
    if (!(mesh.material instanceof THREE.MeshBasicMaterial)) {
      throw new Error('DiegeticHUD requires a MeshBasicMaterial HUD mesh')
    }
    this.material = mesh.material

    this.canvas = document.createElement('canvas')
    this.canvas.width = HUD_TEXTURE_WIDTH
    this.canvas.height = HUD_TEXTURE_HEIGHT
    this.ctx = this.canvas.getContext('2d')

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = false

    this.originalMap = this.material.map
    this.material.map = this.texture
    this.material.needsUpdate = true
  }

  /** Atualiza valores exibidos com dirty-check + throttle de 15Hz. */
  update(state: HudState, dt: number): void {
    // O sweep é uma fonte de dirty própria: mesmo com estado estático o radar
    // continua girando, então o redraw deve acontecer no teto de 15Hz.
    const previousSweep = this.sweepAngle
    this.sweepAngle = (this.sweepAngle + dt * SWEEP_RAD_PER_SEC) % (2 * Math.PI)
    if (this.sweepAngle !== previousSweep) this.dirty = true

    if (
      state.shield !== this.lastShield ||
      state.energy !== this.lastEnergy ||
      state.score !== this.lastScore ||
      state.wave !== this.lastWave
    ) {
      this.dirty = true
    }

    const count = Math.min(state.contacts.length, MAX_RADAR_CONTACTS)
    if (count !== this.lastContactCount) this.dirty = true
    for (let i = 0; i < count; i++) {
      const contact: Contact | undefined = state.contacts[i]
      if (contact === undefined) continue
      const base = i * 3
      if (
        contact.position.x !== this.lastContactPositions[base] ||
        contact.position.y !== this.lastContactPositions[base + 1] ||
        contact.position.z !== this.lastContactPositions[base + 2]
      ) {
        this.dirty = true
        break
      }
    }

    if (!this.dirty) return
    if (!shouldUpdateHud(this.accumulator, dt, HUD_INTERVAL)) {
      this.accumulator += dt
      return
    }

    this.accumulator = 0
    this.draw(state, count)
    this.texture.needsUpdate = true

    this.lastShield = state.shield
    this.lastEnergy = state.energy
    this.lastScore = state.score
    this.lastWave = state.wave
    this.lastContactCount = count
    for (let i = 0; i < count; i++) {
      const contact: Contact | undefined = state.contacts[i]
      if (contact === undefined) continue
      const base = i * 3
      this.lastContactPositions[base] = contact.position.x
      this.lastContactPositions[base + 1] = contact.position.y
      this.lastContactPositions[base + 2] = contact.position.z
    }
    this.dirty = false
  }

  /** Restaura o mapa original e libera a textura gerada. */
  dispose(): void {
    this.material.map = this.originalMap
    this.material.needsUpdate = true
    this.texture.dispose()
  }

  private draw(state: HudState, contactCount: number): void {
    const ctx = this.ctx
    if (ctx === null) return

    ctx.clearRect(0, 0, HUD_TEXTURE_WIDTH, HUD_TEXTURE_HEIGHT)
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.55)'
    ctx.lineWidth = 4
    ctx.strokeRect(6, 6, HUD_TEXTURE_WIDTH - 12, HUD_TEXTURE_HEIGHT - 12)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(228, 20)
    ctx.lineTo(228, HUD_TEXTURE_HEIGHT - 20)
    ctx.stroke()

    this.drawBar(ctx, 24, 44, 188, 18, state.shield, 'SHIELD', '90, 255, 205')
    this.drawBar(ctx, 24, 96, 188, 18, state.energy, 'ENERGY', '255, 200, 80')

    ctx.font = 'bold 20px monospace'
    ctx.fillStyle = 'rgba(150, 240, 255, 0.95)'
    ctx.fillText('SCORE', 24, 166)
    ctx.fillText('WAVE', 24, 216)
    ctx.font = 'bold 26px monospace'
    ctx.fillText(String(state.score), 24, 192)
    ctx.fillText(String(state.wave), 24, 242)

    this.drawRadar(ctx, state, contactCount)
  }

  private drawBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    value: number,
    label: string,
    rgb: string,
  ): void {
    const level = clamp(value, 0, 1)
    ctx.font = 'bold 16px monospace'
    ctx.fillStyle = 'rgba(150, 240, 255, 0.9)'
    ctx.fillText(label, x, y - 8)
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.7)'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, width, height)
    ctx.fillStyle = `rgba(${rgb}, 0.85)`
    ctx.fillRect(x + 2, y + 2, (width - 4) * level, height - 4)
  }

  private drawRadar(ctx: CanvasRenderingContext2D, state: HudState, contactCount: number): void {
    ctx.strokeStyle = 'rgba(90, 220, 255, 0.75)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(RADAR_CX, RADAR_CY, RADAR_RADIUS, 0, 2 * Math.PI)
    ctx.stroke()

    ctx.strokeStyle = 'rgba(90, 220, 255, 0.3)'
    ctx.lineWidth = 1
    for (const ring of RADAR_RINGS) {
      ctx.beginPath()
      ctx.arc(RADAR_CX, RADAR_CY, ring, 0, 2 * Math.PI)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(RADAR_CX - RADAR_RADIUS, RADAR_CY)
    ctx.lineTo(RADAR_CX + RADAR_RADIUS, RADAR_CY)
    ctx.moveTo(RADAR_CX, RADAR_CY - RADAR_RADIUS)
    ctx.lineTo(RADAR_CX, RADAR_CY + RADAR_RADIUS)
    ctx.stroke()

    // Sweep giratório — brilho simples, sem pós-processamento (ADR-04).
    ctx.strokeStyle = 'rgba(120, 255, 220, 0.55)'
    ctx.beginPath()
    ctx.moveTo(RADAR_CX, RADAR_CY)
    ctx.lineTo(
      RADAR_CX + Math.cos(this.sweepAngle) * RADAR_RADIUS,
      RADAR_CY + Math.sin(this.sweepAngle) * RADAR_RADIUS,
    )
    ctx.stroke()

    for (let i = 0; i < contactCount; i++) {
      const contact: Contact | undefined = state.contacts[i]
      if (contact === undefined) continue
      const p = projectToRadar(contact.position, RADAR_RADIUS, this.radarScratch)
      const proximity = clamp(1 - Math.abs(p.depth) / 120, 0, 1)
      const radius = 2 + proximity * 3
      ctx.fillStyle = `rgba(255, 170, 80, ${0.55 + proximity * 0.45})`
      ctx.beginPath()
      ctx.arc(RADAR_CX + p.x, RADAR_CY + p.y, radius, 0, 2 * Math.PI)
      ctx.fill()
    }
  }
}
