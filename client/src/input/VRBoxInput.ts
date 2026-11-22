import { deviceOrientationToQuaternionYXZ, type QuatLike } from './vrbox-math'
import {
  createEmptyGamepadMapping,
  isMappingComplete,
  loadGamepadMapping,
  saveGamepadMapping,
  type GamepadMapping,
} from './gamepad-mapping'
import { applyRadialDeadzone, applyResponseCurve, clampAxis } from './input-math'
import type { InputAdapter, InputState } from './types'

const RESPONSE_EXPONENT = 1.6
const DEFAULT_DEADZONE = 0.15
const AXIS_CAPTURE_THRESHOLD = 0.6
const BUTTON_CAPTURE_THRESHOLD = 0.5

export interface VRBoxStatus {
  fullscreen: 'idle' | 'active' | 'failed' | 'unsupported'
  orientationLock: 'idle' | 'active' | 'failed' | 'unsupported'
  wakeLock: 'idle' | 'active' | 'failed' | 'unsupported'
  deviceOrientation: 'idle' | 'active' | 'failed' | 'unsupported'
  gamepad: 'none' | 'standard' | 'mapped' | 'needs-mapping'
  wizardStep: number // 0 = not showing, 1-3 = active step
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

function readButtonPressed(button: GamepadButton | undefined): boolean {
  if (!button) return false
  if (button.pressed === true) return true
  const v = typeof button.value === 'number' ? button.value : 0
  return Number.isFinite(v) && v > BUTTON_CAPTURE_THRESHOLD
}

function readButtonValue(button: GamepadButton | undefined): number {
  if (!button) return 0
  const v = typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0
  if (!Number.isFinite(v)) return 0
  if (v <= 0) return 0
  if (v >= 1) return 1
  return v
}

type WizardStage = 0 | 1 | 2 | 3

export class VRBoxInput implements InputAdapter {
  private readonly state: InputState = createNeutralState()
  private readonly headQuat: QuatLike = { x: 0, y: 0, z: 0, w: 1 }
  private readonly stickScratch = { x: 0, y: 0 }
  private readonly lookScratch = { x: 0, y: 0 }
  private readonly status: VRBoxStatus = {
    fullscreen: 'idle',
    orientationLock: 'idle',
    wakeLock: 'idle',
    deviceOrientation: 'idle',
    gamepad: 'none',
    wizardStep: 0,
  }
  private attached = false
  private wakeLockSentinel: { release?: () => Promise<void>; addEventListener?: (t: string, l: () => void) => void } | null =
    null
  private mapping: GamepadMapping = loadGamepadMapping()
  private wizardStage: WizardStage = 0
  private wizardOverlay: HTMLDivElement | null = null
  private wizardText: HTMLDivElement | null = null
  private wizardMapping: GamepadMapping = createEmptyGamepadMapping()
  private wizardAxisBaseline: number[] | null = null
  private wizardButtonBaseline: boolean[] | null = null

  private readonly onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    // Use relative deviceorientation only (no absolute/compass). ADR-01: head only.
    if (event.absolute === true) return
    const alpha = typeof event.alpha === 'number' ? event.alpha : 0
    const beta = typeof event.beta === 'number' ? event.beta : 0
    const gamma = typeof event.gamma === 'number' ? event.gamma : 0
    deviceOrientationToQuaternionYXZ(alpha, beta, gamma, this.headQuat)
    this.status.deviceOrientation = 'active'
  }

  private readonly onWakeLockRelease = (): void => {
    this.wakeLockSentinel = null
    if (this.attached && this.status.wakeLock === 'active') {
      this.status.wakeLock = 'idle'
    }
  }

  async attach(): Promise<void> {
    if (this.attached) return
    this.attached = true
    this.mapping = loadGamepadMapping()

    await this.requestFullscreen()
    await this.requestOrientationLock()
    await this.requestWakeLock()
    this.attachDeviceOrientation()
  }

  async detach(): Promise<void> {
    if (!this.attached) return
    this.attached = false
    this.detachDeviceOrientation()
    await this.releaseWakeLock()
    this.hideWizard()
    this.resetState()
    this.status.fullscreen = 'idle'
    this.status.orientationLock = 'idle'
    this.status.wakeLock = 'idle'
    this.status.deviceOrientation = 'idle'
    this.status.gamepad = 'none'
    this.status.wizardStep = 0
  }

  update(_dt: number): void {
    if (!this.attached) return
    const gp = this.readActiveGamepad()
    if (!gp) {
      this.status.gamepad = 'none'
      this.resetCommandState()
      return
    }

    const isStandard = gp.mapping === 'standard'
    if (!isStandard && !isMappingComplete(this.mapping)) {
      this.status.gamepad = 'needs-mapping'
      this.ensureWizard(gp)
      this.captureWizard(gp)
      this.resetCommandState()
      return
    }

    if (this.wizardStage !== 0) this.hideWizard()
    this.status.gamepad = isStandard ? 'standard' : 'mapped'
    if (isStandard) this.applyStandardGamepad(gp)
    else this.applyMappedGamepad(gp)
  }

  getState(): Readonly<InputState> {
    return this.state
  }

  dispose(): void {
    void this.detach()
  }

  getStatus(): Readonly<VRBoxStatus> {
    return this.status
  }

  getHeadQuat(out?: QuatLike): QuatLike {
    const target = out ?? this.headQuat
    target.x = this.headQuat.x
    target.y = this.headQuat.y
    target.z = this.headQuat.z
    target.w = this.headQuat.w
    return target
  }

  private async requestFullscreen(): Promise<void> {
    try {
      if (typeof document === 'undefined') {
        this.status.fullscreen = 'unsupported'
        return
      }
      const el = document.documentElement as HTMLElement & {
        requestFullscreen?: () => Promise<void> | void
      }
      if (!el?.requestFullscreen) {
        this.status.fullscreen = 'unsupported'
        return
      }
      if (document.fullscreenElement) {
        this.status.fullscreen = 'active'
        return
      }
      const result = el.requestFullscreen()
      if (result && typeof (result as Promise<void>).then === 'function') {
        await (result as Promise<void>)
      }
      this.status.fullscreen = document.fullscreenElement ? 'active' : 'failed'
    } catch {
      this.status.fullscreen = 'failed'
    }
  }

  private async requestOrientationLock(): Promise<void> {
    try {
      const orientation = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } })
        .orientation
      if (!orientation || typeof orientation.lock !== 'function') {
        this.status.orientationLock = 'unsupported'
        return
      }
      await orientation.lock('landscape')
      this.status.orientationLock = 'active'
    } catch {
      this.status.orientationLock = 'failed'
    }
  }

  private async requestWakeLock(): Promise<void> {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request?: (type: 'screen') => Promise<any> }
      }
      if (!nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
        this.status.wakeLock = 'unsupported'
        return
      }
      const sentinel = await nav.wakeLock.request('screen')
      this.wakeLockSentinel = sentinel
      if (sentinel && typeof sentinel.addEventListener === 'function') {
        sentinel.addEventListener('release', this.onWakeLockRelease)
      }
      this.status.wakeLock = 'active'
    } catch {
      this.status.wakeLock = 'failed'
    }
  }

  private async releaseWakeLock(): Promise<void> {
    const sentinel = this.wakeLockSentinel
    this.wakeLockSentinel = null
    if (!sentinel || typeof sentinel.release !== 'function') return
    try {
      await sentinel.release()
    } catch {
      // ignore
    }
  }

  private attachDeviceOrientation(): void {
    try {
      if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
        this.status.deviceOrientation = 'unsupported'
        return
      }
      window.addEventListener('deviceorientation', this.onDeviceOrientation as EventListener, true)
      this.status.deviceOrientation = 'idle'
    } catch {
      this.status.deviceOrientation = 'failed'
    }
  }

  private detachDeviceOrientation(): void {
    try {
      if (typeof window !== 'undefined') {
        window.removeEventListener('deviceorientation', this.onDeviceOrientation as EventListener, true)
      }
    } catch {
      // ignore
    }
  }

  private readActiveGamepad(): Gamepad | null {
    try {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null
      const pads = navigator.getGamepads()
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i]
        if (pad && pad.connected) return pad
      }
    } catch {
      return null
    }
    return null
  }

  private applyStandardGamepad(gp: Gamepad): void {
    const axes = gp.axes
    const buttons = gp.buttons
    const left = applyRadialDeadzone(axes[0] ?? 0, axes[1] ?? 0, DEFAULT_DEADZONE, this.stickScratch)
    const right = applyRadialDeadzone(axes[2] ?? 0, axes[3] ?? 0, DEFAULT_DEADZONE, this.lookScratch)

    const rt = readButtonValue(buttons[7])
    const lt = readButtonValue(buttons[6])
    this.state.thrust = clampAxis(rt - lt)
    this.state.strafeX = clampAxis(left.x)
    this.state.strafeY = clampAxis(-left.y)
    this.state.yaw = clampAxis(applyResponseCurve(clampAxis(right.x), RESPONSE_EXPONENT))
    this.state.pitch = clampAxis(applyResponseCurve(clampAxis(-right.y), RESPONSE_EXPONENT))
    this.state.roll = 0
    this.state.firePrimary = readButtonPressed(buttons[0]) || rt > 0.5
    this.state.fireSecondary = readButtonPressed(buttons[1])
    this.state.boost = readButtonPressed(buttons[10]) || readButtonPressed(buttons[5])
  }

  private applyMappedGamepad(gp: Gamepad): void {
    const m = this.mapping
    const rawStrafeX = this.readMappedAxisRaw(gp, m.axes.strafeX, false)
    const rawThrust = this.readMappedAxisRaw(gp, m.axes.thrust, m.inverted.thrust)
    const move = applyRadialDeadzone(rawStrafeX, rawThrust, DEFAULT_DEADZONE, this.stickScratch)

    const rawYaw = this.readMappedAxisRaw(gp, m.axes.yaw, false)
    const rawPitch = this.readMappedAxisRaw(gp, m.axes.pitch, m.inverted.pitch)
    const look = applyRadialDeadzone(rawYaw, rawPitch, DEFAULT_DEADZONE, this.lookScratch)

    this.state.thrust = clampAxis(move.y)
    this.state.strafeX = clampAxis(move.x)
    this.state.strafeY = 0
    this.state.yaw = clampAxis(applyResponseCurve(clampAxis(look.x), RESPONSE_EXPONENT))
    this.state.pitch = clampAxis(applyResponseCurve(clampAxis(look.y), RESPONSE_EXPONENT))
    this.state.roll = 0
    this.state.firePrimary = this.readMappedButton(gp, m.buttons.firePrimary)
    this.state.fireSecondary = this.readMappedButton(gp, m.buttons.fireSecondary)
    this.state.boost = this.readMappedButton(gp, m.buttons.boost)
  }

  private readMappedAxisRaw(gp: Gamepad, index: number, inverted: boolean): number {
    if (index < 0) return 0
    const value = gp.axes[index]
    const v = typeof value === 'number' && Number.isFinite(value) ? value : 0
    const inv = inverted ? -v : v
    if (inv <= -1) return -1
    if (inv >= 1) return 1
    return inv
  }

  private readMappedButton(gp: Gamepad, index: number): boolean {
    if (index < 0) return false
    return readButtonPressed(gp.buttons[index])
  }

  private ensureWizard(gp: Gamepad): void {
    if (this.wizardStage !== 0) return
    this.wizardStage = 1
    this.status.wizardStep = 1
    this.wizardMapping = createEmptyGamepadMapping()
    this.captureBaselines(gp)
    this.showWizard()
    this.renderWizard()
  }

  private captureBaselines(gp: Gamepad): void {
    this.wizardAxisBaseline = Array.from(gp.axes, (v) => (Number.isFinite(v) ? v : 0))
    this.wizardButtonBaseline = Array.from(gp.buttons, (b) => readButtonPressed(b))
  }

  private captureWizard(gp: Gamepad): void {
    if (this.wizardStage === 0) return
    if (!this.wizardAxisBaseline) this.captureBaselines(gp)
    const axisBaseline = this.wizardAxisBaseline
    const buttonBaseline = this.wizardButtonBaseline
    if (!axisBaseline || !buttonBaseline) return

    if (this.wizardStage === 1) {
      // Step 1: capture 2 axes for thrust/strafeX
      const a0 = this.findMovedAxis(gp, axisBaseline, -1)
      const a1 = this.findMovedAxis(gp, axisBaseline, a0)
      if (a0 >= 0 && a1 >= 0) {
        this.wizardMapping.axes.strafeX = a0
        this.wizardMapping.axes.thrust = a1
        this.wizardStage = 2
        this.status.wizardStep = 2
        this.captureBaselines(gp)
        this.renderWizard()
      }
      return
    }

    if (this.wizardStage === 2) {
      // Step 2: capture 2 axes for yaw/pitch
      const a0 = this.findMovedAxis(gp, axisBaseline, -1)
      const a1 = this.findMovedAxis(gp, axisBaseline, a0)
      if (a0 >= 0 && a1 >= 0) {
        this.wizardMapping.axes.yaw = a0
        this.wizardMapping.axes.pitch = a1
        this.wizardStage = 3
        this.status.wizardStep = 3
        this.captureBaselines(gp)
        this.renderWizard()
      }
      return
    }

    if (this.wizardStage === 3) {
      // Step 3: capture 3 buttons for firePrimary/fireSecondary/boost
      const b0 = this.findPressedButton(gp, buttonBaseline, -1)
      const b1 = this.findPressedButton(gp, buttonBaseline, b0)
      const b2 = this.findPressedButton(gp, buttonBaseline, b0, b1)
      if (b0 >= 0 && b1 >= 0 && b2 >= 0) {
        this.wizardMapping.buttons.firePrimary = b0
        this.wizardMapping.buttons.fireSecondary = b1
        this.wizardMapping.buttons.boost = b2
        this.mapping = this.wizardMapping
        saveGamepadMapping(this.mapping)
        this.hideWizard()
      }
    }
  }

  private findMovedAxis(gp: Gamepad, baseline: number[], excludeA: number, excludeB = -1): number {
    for (let i = 0; i < gp.axes.length; i++) {
      if (i === excludeA || i === excludeB) continue
      const base = baseline[i] ?? 0
      const val = gp.axes[i] ?? 0
      if (Math.abs(val - base) >= AXIS_CAPTURE_THRESHOLD) return i
    }
    return -1
  }

  private findPressedButton(gp: Gamepad, baseline: boolean[], excludeA: number, excludeB = -1): number {
    for (let i = 0; i < gp.buttons.length; i++) {
      if (i === excludeA || i === excludeB) continue
      const base = baseline[i] ?? false
      const pressed = readButtonPressed(gp.buttons[i])
      if (pressed && !base) return i
    }
    return -1
  }

  private showWizard(): void {
    if (typeof document === 'undefined') return
    if (this.wizardOverlay) return
    const overlay = document.createElement('div')
    overlay.style.position = 'fixed'
    overlay.style.left = '50%'
    overlay.style.bottom = '1rem'
    overlay.style.transform = 'translateX(-50%)'
    overlay.style.zIndex = '20'
    overlay.style.padding = '0.75rem 1rem'
    overlay.style.background = 'rgba(5,7,15,0.92)'
    overlay.style.border = '1px solid #59d8ff'
    overlay.style.color = '#dff'
    overlay.style.font = '14px monospace'
    overlay.style.maxWidth = '90vw'
    overlay.style.pointerEvents = 'none'
    const text = document.createElement('div')
    overlay.append(text)
    document.body.append(overlay)
    this.wizardOverlay = overlay
    this.wizardText = text
  }

  private renderWizard(): void {
    if (!this.wizardText) return
    if (this.wizardStage === 1) {
      this.wizardText.textContent =
        'Gamepad BT: Passo 1/3 — Mova o stick de STRAFE e depois o eixo de THRUST.'
      return
    }
    if (this.wizardStage === 2) {
      this.wizardText.textContent = 'Gamepad BT: Passo 2/3 — Mova o eixo de YAW e depois o de PITCH.'
      return
    }
    if (this.wizardStage === 3) {
      this.wizardText.textContent =
        'Gamepad BT: Passo 3/3 — Pressione FIRE, MISSILE/SECUNDÁRIO e BOOST.'
    }
  }

  private hideWizard(): void {
    this.wizardStage = 0
    this.status.wizardStep = 0
    this.wizardAxisBaseline = null
    this.wizardButtonBaseline = null
    if (this.wizardOverlay) {
      this.wizardOverlay.remove()
      this.wizardOverlay = null
      this.wizardText = null
    }
  }

  private resetCommandState(): void {
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

  private resetState(): void {
    this.resetCommandState()
    this.headQuat.x = 0
    this.headQuat.y = 0
    this.headQuat.z = 0
    this.headQuat.w = 1
  }
}
