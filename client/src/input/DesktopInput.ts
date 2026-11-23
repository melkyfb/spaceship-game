import { mapDesktopButtons, type DesktopButtonInput, type DesktopButtonState } from './desktop-input-math'
import { applyRadialDeadzone, applyResponseCurve, clampAxis } from './input-math'
import type { InputAdapter, InputState } from './types'

const MOUSE_SENSITIVITY = 0.0025
const GAMEPAD_DEADZONE = 0.15
const RESPONSE_EXPONENT = 1.6

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

function clamp01Signed(value: number): number {
  if (value <= -1) return -1
  if (value >= 1) return 1
  return value
}

function readGamepadButtonValue(button: GamepadButton | undefined): number {
  if (!button) return 0
  const value = typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function readGamepadButtonPressed(button: GamepadButton | undefined): boolean {
  if (!button) return false
  return button.pressed === true || readGamepadButtonValue(button) > 0.5
}

export interface FreeLookState {
  active: boolean
  yaw: number
  pitch: number
  deltaYaw: number
  deltaPitch: number
}

export class DesktopInput implements InputAdapter {
  private readonly state: InputState = createNeutralState()
  private readonly keys = new Set<string>()
  private primaryMouse = false
  private secondaryMouse = false
  private mouseDX = 0
  private mouseDY = 0
  private pointerLocked = false
  private attachedTarget: HTMLElement | null = null
  private readonly freeLookState: FreeLookState = {
    active: false,
    yaw: 0,
    pitch: 0,
    deltaYaw: 0,
    deltaPitch: 0,
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.keys.add(event.code)
    if (event.code === 'AltLeft' || event.code === 'AltRight') {
      event.preventDefault()
    }
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code)
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) this.primaryMouse = true
    if (event.button === 2) this.secondaryMouse = true
    this.requestPointerLock()
  }

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.primaryMouse = false
    if (event.button === 2) this.secondaryMouse = false
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) return
    this.mouseDX += event.movementX
    this.mouseDY += event.movementY
  }

  private readonly onPointerLockChange = (): void => {
    const locked = this.attachedTarget !== null && document.pointerLockElement === this.attachedTarget
    this.pointerLocked = locked
    if (!locked) {
      this.resetAxes()
    }
  }

  private readonly onBlur = (): void => {
    this.resetAxes()
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault()
  }

  attach(target: HTMLElement): void {
    if (this.attachedTarget === target) return
    this.detach()
    this.attachedTarget = target
    target.addEventListener('mousedown', this.onMouseDown)
    target.addEventListener('mouseup', this.onMouseUp)
    target.addEventListener('mousemove', this.onMouseMove)
    target.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
  }

  detach(): void {
    const target = this.attachedTarget
    if (!target) return
    target.removeEventListener('mousedown', this.onMouseDown)
    target.removeEventListener('mouseup', this.onMouseUp)
    target.removeEventListener('mousemove', this.onMouseMove)
    target.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    if (document.pointerLockElement === target) {
      void document.exitPointerLock?.()
    }
    this.attachedTarget = null
    this.pointerLocked = false
    this.resetAxes()
  }

  private readonly buttonInput: DesktopButtonInput = {
    keys: this.keys,
    primaryMouse: false,
    secondaryMouse: false,
  }
  private readonly buttonState: DesktopButtonState = {
    thrust: 0,
    strafeX: 0,
    strafeY: 0,
    roll: 0,
    firePrimary: false,
    fireSecondary: false,
    boost: false,
    freeLook: false,
  }
  private readonly gpScratch = {
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

  update(_dt: number): void {
    this.poll()
  }

  poll(gamepad?: Gamepad | null): void {
    this.buttonInput.primaryMouse = this.primaryMouse
    this.buttonInput.secondaryMouse = this.secondaryMouse
    const buttons = mapDesktopButtons(this.buttonInput, this.buttonState)
    const freeLook = buttons.freeLook

    // Consume accumulated mouse delta once per poll.
    const mdx = this.mouseDX
    const mdy = this.mouseDY
    this.mouseDX = 0
    this.mouseDY = 0

    const rawYaw = clampAxis(-mdx * MOUSE_SENSITIVITY)
    const rawPitch = clampAxis(-mdy * MOUSE_SENSITIVITY)
    const mouseYaw = applyResponseCurve(rawYaw, RESPONSE_EXPONENT)
    const mousePitch = applyResponseCurve(rawPitch, RESPONSE_EXPONENT)

    const fl = this.freeLookState
    fl.active = freeLook
    if (freeLook) {
      fl.deltaYaw = mouseYaw
      fl.deltaPitch = mousePitch
      fl.yaw = clamp01Signed(fl.yaw + mouseYaw)
      fl.pitch = clamp01Signed(fl.pitch + mousePitch)
    } else {
      fl.deltaYaw = 0
      fl.deltaPitch = 0
      fl.yaw = 0
      fl.pitch = 0
    }

    let thrust = buttons.thrust
    let strafeX = buttons.strafeX
    let strafeY = buttons.strafeY
    let yaw = freeLook ? 0 : mouseYaw
    let pitch = freeLook ? 0 : mousePitch
    let roll = buttons.roll
    let firePrimary = buttons.firePrimary
    let fireSecondary = buttons.fireSecondary
    let boost = buttons.boost

    const gp = gamepad !== undefined ? gamepad : this.readFirstGamepad()
    if (gp) {
      this.readGamepad(gp)
      const g = this.gpScratch
      if (g.thrust !== 0) thrust = g.thrust
      if (g.strafeX !== 0) strafeX = g.strafeX
      if (g.strafeY !== 0) strafeY = g.strafeY
      if (!freeLook && g.yaw !== 0) yaw = g.yaw
      if (!freeLook && g.pitch !== 0) pitch = g.pitch
      if (g.roll !== 0) roll = g.roll
      if (g.firePrimary) firePrimary = true
      if (g.fireSecondary) fireSecondary = true
      if (g.boost) boost = true
    }

    this.state.thrust = clampAxis(thrust)
    this.state.strafeX = clampAxis(strafeX)
    this.state.strafeY = clampAxis(strafeY)
    this.state.yaw = clampAxis(yaw)
    this.state.pitch = clampAxis(pitch)
    this.state.roll = clampAxis(roll)
    this.state.firePrimary = firePrimary
    this.state.fireSecondary = fireSecondary
    this.state.boost = boost
  }

  getState(): Readonly<InputState> {
    return this.state
  }

  isFreeLookActive(): boolean {
    return this.freeLookState.active
  }

  getFreeLookState(): Readonly<FreeLookState> {
    return this.freeLookState
  }

  dispose(): void {
    this.detach()
  }

  private requestPointerLock(): void {
    const target = this.attachedTarget
    if (!target) return
    if (document.pointerLockElement === target) {
      this.pointerLocked = true
      return
    }
    const result = target.requestPointerLock?.()
    if (result && typeof (result as Promise<void>).catch === 'function') {
      ;(result as Promise<void>).catch(() => {
        // Pointer lock may be denied; keep polling keyboard/gamepad state.
      })
    }
  }

  private readFirstGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null
    let pads: (Gamepad | null)[]
    try {
      pads = navigator.getGamepads()
    } catch {
      return null
    }
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i]
      if (pad && pad.connected) return pad
    }
    return null
  }

  private readGamepad(gp: Gamepad): void {
    const out = this.gpScratch
    const axes = gp.axes
    const buttons = gp.buttons

    const lx = axes[0] ?? 0
    const ly = axes[1] ?? 0
    const rx = axes[2] ?? 0
    const ry = axes[3] ?? 0

    const leftStick = applyRadialDeadzone(lx, ly, GAMEPAD_DEADZONE)
    const rightStick = applyRadialDeadzone(rx, ry, GAMEPAD_DEADZONE)

    const rt = readGamepadButtonValue(buttons[7])
    const lt = readGamepadButtonValue(buttons[6])
    const rollLeft = readGamepadButtonPressed(buttons[4])
    const rollRight = readGamepadButtonPressed(buttons[5])

    out.thrust = clamp01Signed(rt - lt)
    out.strafeX = clampAxis(leftStick.x)
    out.strafeY = clampAxis(-leftStick.y)
    out.yaw = applyResponseCurve(clampAxis(-rightStick.x), RESPONSE_EXPONENT)
    out.pitch = applyResponseCurve(clampAxis(-rightStick.y), RESPONSE_EXPONENT)
    out.roll = rollLeft === rollRight ? 0 : rollRight ? 1 : -1
    out.firePrimary = readGamepadButtonPressed(buttons[0]) || rt > 0.5
    out.fireSecondary = readGamepadButtonPressed(buttons[1]) || lt > 0.5
    out.boost = readGamepadButtonPressed(buttons[10]) || readGamepadButtonPressed(buttons[3])
  }

  private resetAxes(): void {
    this.keys.clear()
    this.primaryMouse = false
    this.secondaryMouse = false
    this.pointerLocked = false
    this.mouseDX = 0
    this.mouseDY = 0
    this.freeLookState.active = false
    this.freeLookState.yaw = 0
    this.freeLookState.pitch = 0
    this.freeLookState.deltaYaw = 0
    this.freeLookState.deltaPitch = 0
    this.state.thrust = 0
    this.state.strafeX = 0
    this.state.strafeY = 0
    this.state.yaw = 0
    this.state.pitch = 0
    this.state.roll = 0
    this.state.firePrimary = false
    this.state.fireSecondary = false
    this.state.boost = false
  }
}
