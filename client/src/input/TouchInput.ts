import { applyResponseCurve, clampAxis } from './input-math'
import type { InputAdapter, InputState } from './types'

const DEFAULT_DEADZONE = 0.15
const RESPONSE_EXPONENT = 1.6
const DEFAULT_JOYSTICK_RADIUS_PX = 56

export type TouchSide = 'left' | 'right'
export type TouchSideAssignment = TouchSide

export interface TouchJoystickState {
  active: boolean
  identifier: number
  centerX: number
  centerY: number
  x: number
  y: number
}

export interface TouchButtonState {
  firePrimary: boolean
  fireSecondary: boolean
  boost: boolean
}

function createNeutralState(): InputState {
  return {
    thrust: 0,
    strafeX: 0,
    strafeY: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    firePrimary: false,
    fireSecondary: false,
    boost: false,
  }
}

function clampFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback
}

/**
 * Normaliza delta toque-centro para eixo [-1,1] com deadzone radial e reescalonamento.
 * Função pura para testes e uso no hot path.
 */
export function normalizeTouchJoystick(
  centerX: number,
  centerY: number,
  touchX: number,
  touchY: number,
  radius: number,
  deadzone = DEFAULT_DEADZONE,
  out?: { x: number; y: number },
): { x: number; y: number } {
  const r = clampFinite(radius, DEFAULT_JOYSTICK_RADIUS_PX)
  const target = out ?? { x: 0, y: 0 }
  if (r <= 0) {
    target.x = 0
    target.y = 0
    return target
  }
  const dx = clampFinite(touchX) - clampFinite(centerX)
  const dy = clampFinite(touchY) - clampFinite(centerY)
  const rawX = clampAxis(dx / r)
  const rawY = clampAxis(dy / r)
  const dz = Number.isFinite(deadzone) ? Math.max(0, Math.min(deadzone, 1)) : DEFAULT_DEADZONE
  const mag = Math.hypot(rawX, rawY)
  if (mag <= dz || mag === 0 || dz >= 1) {
    target.x = 0
    target.y = 0
    return target
  }
  const clampedMag = Math.min(mag, 1)
  const scaled = (clampedMag - dz) / (1 - dz)
  const norm = scaled / mag
  target.x = rawX * norm
  target.y = rawY * norm
  return target
}

/**
 * Atribui um toque a lado esquerdo/direito sem cruzar identificadores.
 * Mantém atribuição existente; para novos toques usa o ponto médio da viewport.
 * Registra a atribuição no mapa fornecido.
 */
export function assignTouchToSide(
  identifier: number,
  touchX: number,
  viewportWidth: number,
  assignments: Map<number, TouchSideAssignment>,
): TouchSide {
  const existing = assignments.get(identifier)
  if (existing !== undefined) return existing

  const width = clampFinite(viewportWidth, 1)
  const mid = width > 0 ? width / 2 : 0
  const side: TouchSide = clampFinite(touchX) < mid ? 'left' : 'right'
  assignments.set(identifier, side)
  return side
}

interface ActiveJoystick {
  identifier: number
  centerX: number
  centerY: number
  pointerX: number
  pointerY: number
  x: number
  y: number
}

interface ActiveButton {
  identifier: number
}

function createActiveJoystick(): ActiveJoystick {
  return {
    identifier: -1,
    centerX: 0,
    centerY: 0,
    pointerX: 0,
    pointerY: 0,
    x: 0,
    y: 0,
  }
}

export class TouchInput implements InputAdapter {
  private readonly state: InputState = createNeutralState()
  private readonly assignments = new Map<number, TouchSideAssignment>()
  private readonly left: ActiveJoystick = createActiveJoystick()
  private readonly right: ActiveJoystick = createActiveJoystick()
  private leftActive = false
  private rightActive = false

  private readonly fireButton: ActiveButton = { identifier: -1 }
  private readonly missileButton: ActiveButton = { identifier: -1 }
  private readonly boostButton: ActiveButton = { identifier: -1 }
  private fireActive = false
  private missileActive = false
  private boostActive = false

  private attachedEl: HTMLElement | null = null
  private overlay: HTMLDivElement | null = null
  private leftBaseEl: HTMLDivElement | null = null
  private leftKnobEl: HTMLDivElement | null = null
  private rightBaseEl: HTMLDivElement | null = null
  private rightKnobEl: HTMLDivElement | null = null
  private fireEl: HTMLButtonElement | null = null
  private missileEl: HTMLButtonElement | null = null
  private boostEl: HTMLButtonElement | null = null

  private readonly onTouchStart = (event: TouchEvent): void => {
    this.handleTouchStart(event)
  }
  private readonly onTouchMove = (event: TouchEvent): void => {
    this.handleTouchMove(event)
  }
  private readonly onTouchEnd = (event: TouchEvent): void => {
    this.handleTouchEnd(event)
  }
  private readonly onTouchCancel = (event: TouchEvent): void => {
    this.handleTouchEnd(event)
  }

  attach(el: HTMLElement): void {
    if (this.attachedEl === el) return
    this.detach()
    this.attachedEl = el
    this.ensureOverlay()
    const target = this.overlay
    if (!target) return
    target.addEventListener('touchstart', this.onTouchStart, { passive: false })
    target.addEventListener('touchmove', this.onTouchMove, { passive: false })
    target.addEventListener('touchend', this.onTouchEnd, { passive: false })
    target.addEventListener('touchcancel', this.onTouchCancel, { passive: false })
  }

  detach(): void {
    const target = this.overlay
    if (target) {
      target.removeEventListener('touchstart', this.onTouchStart)
      target.removeEventListener('touchmove', this.onTouchMove)
      target.removeEventListener('touchend', this.onTouchEnd)
      target.removeEventListener('touchcancel', this.onTouchCancel)
    }
    this.attachedEl = null
    this.teardownOverlay()
    this.resetAll()
  }

  update(_dt: number): void {
    // State is event-driven; update keeps the adapter contract.
    this.syncStateFromJoysticks()
  }

  getState(): Readonly<InputState> {
    return this.state
  }

  dispose(): void {
    this.detach()
  }

  private ensureOverlay(): void {
    if (this.overlay) return
    const overlay = document.createElement('div')
    overlay.className = 'touch-overlay'
    overlay.setAttribute('aria-hidden', 'true')

    const leftBase = document.createElement('div')
    leftBase.className = 'touch-joystick touch-joystick-left'
    const leftKnob = document.createElement('div')
    leftKnob.className = 'touch-joystick-knob'
    leftBase.append(leftKnob)

    const rightBase = document.createElement('div')
    rightBase.className = 'touch-joystick touch-joystick-right'
    const rightKnob = document.createElement('div')
    rightKnob.className = 'touch-joystick-knob'
    rightBase.append(rightKnob)

    const buttons = document.createElement('div')
    buttons.className = 'touch-buttons'

    const fire = document.createElement('button')
    fire.type = 'button'
    fire.className = 'touch-btn touch-btn-fire'
    fire.textContent = 'FIRE'

    const missile = document.createElement('button')
    missile.type = 'button'
    missile.className = 'touch-btn touch-btn-missile'
    missile.textContent = 'MISSILE'

    const boost = document.createElement('button')
    boost.type = 'button'
    boost.className = 'touch-btn touch-btn-boost'
    boost.textContent = 'BOOST'

    buttons.append(fire, missile, boost)
    overlay.append(leftBase, rightBase, buttons)

    document.body.append(overlay)

    this.overlay = overlay
    this.leftBaseEl = leftBase
    this.leftKnobEl = leftKnob
    this.rightBaseEl = rightBase
    this.rightKnobEl = rightKnob
    this.fireEl = fire
    this.missileEl = missile
    this.boostEl = boost

    this.hideJoystick(leftBase)
    this.hideJoystick(rightBase)
  }

  private teardownOverlay(): void {
    if (this.overlay) {
      this.overlay.remove()
    }
    this.overlay = null
    this.leftBaseEl = null
    this.leftKnobEl = null
    this.rightBaseEl = null
    this.rightKnobEl = null
    this.fireEl = null
    this.missileEl = null
    this.boostEl = null
  }

  private handleTouchStart(event: TouchEvent): void {
    if (!this.attachedEl) return
    const changed = event.changedTouches
    const viewportWidth = this.getViewportWidth()
    let handled = false

    for (let i = 0; i < changed.length; i++) {
      const touch = changed.item(i)
      if (!touch) continue
      if (this.isButtonTarget(touch.target)) {
        this.handleButtonTouchStart(touch)
        handled = true
        continue
      }
      handled = this.claimJoystickTouch(touch, viewportWidth) || handled
    }

    if (handled || changed.length > 0) {
      event.preventDefault()
    }
    this.syncStateFromJoysticks()
    this.renderOverlay()
  }

  private handleTouchMove(event: TouchEvent): void {
    if (!this.attachedEl) return
    const changed = event.changedTouches
    let handled = false
    for (let i = 0; i < changed.length; i++) {
      const touch = changed.item(i)
      if (!touch) continue
      if (this.leftActive && touch.identifier === this.left.identifier) {
        this.updateJoystickFromTouch(this.left, touch)
        handled = true
        continue
      }
      if (this.rightActive && touch.identifier === this.right.identifier) {
        this.updateJoystickFromTouch(this.right, touch)
        handled = true
        continue
      }
      if (this.isButtonIdentifier(touch.identifier)) {
        handled = true
      }
    }
    if (handled) event.preventDefault()
    this.syncStateFromJoysticks()
    this.renderOverlay()
  }

  private handleTouchEnd(event: TouchEvent): void {
    const changed = event.changedTouches
    let handled = false
    for (let i = 0; i < changed.length; i++) {
      const touch = changed.item(i)
      if (!touch) continue
      const id = touch.identifier
      this.assignments.delete(id)

      if (this.leftActive && id === this.left.identifier) {
        this.leftActive = false
        this.resetJoystick(this.left)
        handled = true
      }
      if (this.rightActive && id === this.right.identifier) {
        this.rightActive = false
        this.resetJoystick(this.right)
        handled = true
      }
      if (this.fireActive && id === this.fireButton.identifier) {
        this.fireActive = false
        this.fireButton.identifier = -1
        handled = true
      }
      if (this.missileActive && id === this.missileButton.identifier) {
        this.missileActive = false
        this.missileButton.identifier = -1
        handled = true
      }
      if (this.boostActive && id === this.boostButton.identifier) {
        this.boostActive = false
        this.boostButton.identifier = -1
        handled = true
      }
    }
    if (handled) event.preventDefault()
    this.syncStateFromJoysticks()
    this.renderOverlay()
  }

  private claimJoystickTouch(touch: Touch, viewportWidth: number): boolean {
    const side = assignTouchToSide(touch.identifier, touch.clientX, viewportWidth, this.assignments)
    if (side === 'left') {
      if (this.leftActive) return this.left.identifier === touch.identifier
      this.activateJoystick(this.left, touch)
      this.leftActive = true
      return true
    }
    if (this.rightActive) return this.right.identifier === touch.identifier
    this.activateJoystick(this.right, touch)
    this.rightActive = true
    return true
  }

  private activateJoystick(joy: ActiveJoystick, touch: Touch): void {
    joy.identifier = touch.identifier
    joy.centerX = touch.clientX
    joy.centerY = touch.clientY
    joy.pointerX = touch.clientX
    joy.pointerY = touch.clientY
    joy.x = 0
    joy.y = 0
  }

  private readonly normScratch = { x: 0, y: 0 }

  private updateJoystickFromTouch(joy: ActiveJoystick, touch: Touch): void {
    joy.pointerX = touch.clientX
    joy.pointerY = touch.clientY
    const norm = normalizeTouchJoystick(
      joy.centerX,
      joy.centerY,
      touch.clientX,
      touch.clientY,
      DEFAULT_JOYSTICK_RADIUS_PX,
      DEFAULT_DEADZONE,
      this.normScratch,
    )
    joy.x = norm.x
    joy.y = norm.y
  }

  private resetJoystick(joy: ActiveJoystick): void {
    joy.identifier = -1
    joy.centerX = 0
    joy.centerY = 0
    joy.pointerX = 0
    joy.pointerY = 0
    joy.x = 0
    joy.y = 0
  }

  private syncStateFromJoysticks(): void {
    // Left joystick: translação (x -> strafeX, y -> thrust; screen up = negative y = thrust positive)
    if (this.leftActive) {
      this.state.strafeX = clampAxis(this.left.x)
      this.state.thrust = clampAxis(-this.left.y)
    } else {
      this.state.strafeX = 0
      this.state.thrust = 0
    }

    // Right joystick: rotação (x -> yaw, y -> pitch; screen up = positive pitch)
    if (this.rightActive) {
      this.state.yaw = clampAxis(applyResponseCurve(this.right.x, RESPONSE_EXPONENT))
      this.state.pitch = clampAxis(applyResponseCurve(-this.right.y, RESPONSE_EXPONENT))
    } else {
      this.state.yaw = 0
      this.state.pitch = 0
    }

    this.state.strafeY = 0
    this.state.roll = 0
    this.state.firePrimary = this.fireActive
    this.state.fireSecondary = this.missileActive
    this.state.boost = this.boostActive
  }

  private isButtonTarget(target: EventTarget | null): boolean {
    return target === this.fireEl || target === this.missileEl || target === this.boostEl
  }

  private isButtonIdentifier(identifier: number): boolean {
    return (
      (this.fireActive && this.fireButton.identifier === identifier) ||
      (this.missileActive && this.missileButton.identifier === identifier) ||
      (this.boostActive && this.boostButton.identifier === identifier)
    )
  }

  private handleButtonTouchStart(touch: Touch): void {
    if (touch.target === this.fireEl) {
      this.fireActive = true
      this.fireButton.identifier = touch.identifier
      return
    }
    if (touch.target === this.missileEl) {
      this.missileActive = true
      this.missileButton.identifier = touch.identifier
      return
    }
    if (touch.target === this.boostEl) {
      this.boostActive = true
      this.boostButton.identifier = touch.identifier
    }
  }

  private getViewportWidth(): number {
    if (this.attachedEl) {
      const w = this.attachedEl.clientWidth
      if (w > 0) return w
    }
    if (typeof window !== 'undefined') return window.innerWidth || 1
    return 1
  }

  private renderOverlay(): void {
    this.renderJoystick(this.leftActive, this.left, this.leftBaseEl, this.leftKnobEl)
    this.renderJoystick(this.rightActive, this.right, this.rightBaseEl, this.rightKnobEl)
    this.setButtonPressed(this.fireEl, this.fireActive)
    this.setButtonPressed(this.missileEl, this.missileActive)
    this.setButtonPressed(this.boostEl, this.boostActive)
  }

  private renderJoystick(
    active: boolean,
    joy: ActiveJoystick,
    base: HTMLDivElement | null,
    knob: HTMLDivElement | null,
  ): void {
    if (!base || !knob) return
    if (!active) {
      this.hideJoystick(base)
      return
    }
    base.style.display = 'block'
    base.style.left = `${joy.centerX}px`
    base.style.top = `${joy.centerY}px`
    const dx = clampAxis((joy.pointerX - joy.centerX) / DEFAULT_JOYSTICK_RADIUS_PX) * DEFAULT_JOYSTICK_RADIUS_PX
    const dy = clampAxis((joy.pointerY - joy.centerY) / DEFAULT_JOYSTICK_RADIUS_PX) * DEFAULT_JOYSTICK_RADIUS_PX
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }

  private hideJoystick(base: HTMLDivElement): void {
    base.style.display = 'none'
  }

  private setButtonPressed(el: HTMLButtonElement | null, pressed: boolean): void {
    if (!el) return
    if (pressed) el.classList.add('is-pressed')
    else el.classList.remove('is-pressed')
  }

  private resetAll(): void {
    this.assignments.clear()
    this.leftActive = false
    this.rightActive = false
    this.fireActive = false
    this.missileActive = false
    this.boostActive = false
    this.fireButton.identifier = -1
    this.missileButton.identifier = -1
    this.boostButton.identifier = -1
    this.resetJoystick(this.left)
    this.resetJoystick(this.right)
    this.state.thrust = 0
    this.state.strafeX = 0
    this.state.strafeY = 0
    this.state.yaw = 0
    this.state.pitch = 0
    this.state.roll = 0
    this.state.firePrimary = false
    this.state.fireSecondary = false
    this.state.boost = false
    this.renderOverlay()
  }
}

