import { deviceOrientationToQuaternionYXZ, type QuatLike } from './vrbox-math'
import {
  isMappingComplete,
  loadGamepadMapping,
  saveGamepadMapping,
  type GamepadMapping,
} from './gamepad-mapping'
import { applyRadialDeadzone, applyResponseCurve, clampAxis } from './input-math'
import {
  advanceVRBoxWizard,
  createVRBoxWizardState,
  type VRBoxWizardState,
} from './vrbox-wizard'
import type { InputAdapter, InputState } from './types'

const RESPONSE_EXPONENT = 1.6
const DEFAULT_DEADZONE = 0.15
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
  private wizard: VRBoxWizardState | null = null
  private wizardOverlay: HTMLDivElement | null = null
  private wizardText: HTMLDivElement | null = null

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
    this.hideWizard()
    this.resetState()
    this.status.fullscreen = 'idle'
    this.status.orientationLock = 'idle'
    this.status.wakeLock = 'idle'
    this.status.deviceOrientation = 'idle'
    this.status.gamepad = 'none'
    this.status.wizardStep = 0
    await this.releaseWakeLock()
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

    if (this.wizard) this.hideWizard()
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
    this.state.yaw = clampAxis(applyResponseCurve(clampAxis(-right.x), RESPONSE_EXPONENT))
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
    this.state.yaw = clampAxis(applyResponseCurve(clampAxis(-look.x), RESPONSE_EXPONENT))
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

  private ensureWizard(_gp: Gamepad): void {
    if (this.wizard) return
    this.wizard = createVRBoxWizardState()
    this.status.wizardStep = this.wizard.stage
    this.showWizard()
    this.renderWizard()
  }

  private captureWizard(gp: Gamepad): void {
    if (!this.wizard) return
    const snapshot = {
      axes: Array.from(gp.axes, (v) => (Number.isFinite(v) ? v : 0)),
      buttons: Array.from(gp.buttons, (b) => readButtonPressed(b)),
    }
    const next = advanceVRBoxWizard(this.wizard, snapshot)
    this.wizard = next

    if (next.stage === 0) {
      this.mapping = next.mapping
      saveGamepadMapping(this.mapping)
      this.hideWizard()
      return
    }

    this.status.wizardStep = next.stage
    this.renderWizard()
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
    if (!this.wizardText || !this.wizard) return
    const w = this.wizard
    const releaseHint = w.waitingRelease ? ' Solte o controle.' : ''
    if (w.stage === 1) {
      const label = w.subStep === 0 ? 'Mova o eixo de STRAFE' : 'Mova o eixo de THRUST'
      this.wizardText.textContent = `Gamepad BT: Passo 1/3 — ${label}.${releaseHint}`
      return
    }
    if (w.stage === 2) {
      const label = w.subStep === 0 ? 'Mova o eixo de YAW' : 'Mova o eixo de PITCH'
      this.wizardText.textContent = `Gamepad BT: Passo 2/3 — ${label}.${releaseHint}`
      return
    }
    if (w.stage === 3) {
      const labels = ['Pressione FIRE', 'Pressione MISSILE/SECUNDÁRIO', 'Pressione BOOST']
      const label = labels[w.subStep] ?? 'Pressione botão'
      this.wizardText.textContent = `Gamepad BT: Passo 3/3 — ${label}.${releaseHint}`
    }
  }

  private hideWizard(): void {
    this.wizard = null
    this.status.wizardStep = 0
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
