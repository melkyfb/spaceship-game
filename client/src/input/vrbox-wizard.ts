import { createEmptyGamepadMapping, type GamepadMapping } from './gamepad-mapping'

export const WIZARD_AXIS_CAPTURE_THRESHOLD = 0.6
export const WIZARD_AXIS_RELEASE_THRESHOLD = 0.25
export const WIZARD_BUTTON_CAPTURE_THRESHOLD = 0.5

export type VRBoxWizardStage = 0 | 1 | 2 | 3

export interface VRBoxWizardSnapshot {
  axes: ReadonlyArray<number>
  buttons: ReadonlyArray<boolean>
}

export interface VRBoxWizardState {
  stage: VRBoxWizardStage
  /** Sub-step index within the current stage (0-based). */
  subStep: number
  mapping: GamepadMapping
  /** True when a control has been captured and we wait for it to return to neutral/released. */
  waitingRelease: boolean
  /** Index of the control currently waiting for release, or -1. */
  capturedIndex: number
  /** Axis/button kind being captured: 'axis' or 'button'. */
  captureKind: 'axis' | 'button' | null
}

type CaptureTarget =
  | { kind: 'axis'; stage: 1 | 2; key: 'strafeX' | 'thrust' | 'yaw' | 'pitch' }
  | { kind: 'button'; stage: 3; key: 'firePrimary' | 'fireSecondary' | 'boost' }

const STAGE_TARGETS: readonly (readonly CaptureTarget[])[] = [
  [], // stage 0
  [
    { kind: 'axis', stage: 1, key: 'strafeX' },
    { kind: 'axis', stage: 1, key: 'thrust' },
  ],
  [
    { kind: 'axis', stage: 2, key: 'yaw' },
    { kind: 'axis', stage: 2, key: 'pitch' },
  ],
  [
    { kind: 'button', stage: 3, key: 'firePrimary' },
    { kind: 'button', stage: 3, key: 'fireSecondary' },
    { kind: 'button', stage: 3, key: 'boost' },
  ],
]

function cloneMapping(m: GamepadMapping): GamepadMapping {
  return {
    axes: { ...m.axes },
    buttons: { ...m.buttons },
    inverted: { ...m.inverted },
  }
}

export function createVRBoxWizardState(_snapshot?: VRBoxWizardSnapshot): VRBoxWizardState {
  return {
    stage: 1,
    subStep: 0,
    mapping: createEmptyGamepadMapping(),
    waitingRelease: false,
    capturedIndex: -1,
    captureKind: null,
  }
}

function isAxisUsed(mapping: GamepadMapping, index: number): boolean {
  const a = mapping.axes
  return a.thrust === index || a.strafeX === index || a.yaw === index || a.pitch === index
}

function isButtonUsed(mapping: GamepadMapping, index: number): boolean {
  const b = mapping.buttons
  return b.firePrimary === index || b.fireSecondary === index || b.boost === index
}

function axisActive(value: number): boolean {
  return Math.abs(Number.isFinite(value) ? value : 0) >= WIZARD_AXIS_CAPTURE_THRESHOLD
}

function axisReleased(value: number): boolean {
  return Math.abs(Number.isFinite(value) ? value : 0) <= WIZARD_AXIS_RELEASE_THRESHOLD
}

function buttonActive(value: boolean): boolean {
  return value === true
}

function buttonReleased(value: boolean): boolean {
  return value !== true
}

function getCurrentTarget(state: VRBoxWizardState): CaptureTarget | null {
  const targets = STAGE_TARGETS[state.stage]
  if (!targets) return null
  return targets[state.subStep] ?? null
}

function assignTarget(mapping: GamepadMapping, target: CaptureTarget, index: number): void {
  if (target.kind === 'axis') mapping.axes[target.key] = index
  else mapping.buttons[target.key] = index
}

function nextAfterCapture(state: VRBoxWizardState): VRBoxWizardState {
  const targets = STAGE_TARGETS[state.stage] ?? []
  const nextSub = state.subStep + 1
  if (nextSub < targets.length) {
    return { ...state, subStep: nextSub, waitingRelease: false, capturedIndex: -1, captureKind: null }
  }
  const nextStage = ((state.stage + 1) as VRBoxWizardStage)
  if (nextStage > 3) {
    return { ...state, stage: 0, subStep: 0, waitingRelease: false, capturedIndex: -1, captureKind: null }
  }
  return { ...state, stage: nextStage, subStep: 0, waitingRelease: false, capturedIndex: -1, captureKind: null }
}

export function advanceVRBoxWizard(
  state: VRBoxWizardState,
  snapshot: VRBoxWizardSnapshot,
): VRBoxWizardState {
  if (state.stage === 0) return state
  const target = getCurrentTarget(state)
  if (!target) return { ...state, stage: 0, subStep: 0 }

  // Waiting for the captured control to be released before allowing next capture.
  if (state.waitingRelease) {
    if (state.captureKind === 'axis') {
      const val = snapshot.axes[state.capturedIndex] ?? 0
      if (axisReleased(val)) return nextAfterCapture({ ...state })
      return state
    }
    if (state.captureKind === 'button') {
      const val = snapshot.buttons[state.capturedIndex] ?? false
      if (buttonReleased(val)) return nextAfterCapture({ ...state })
      return state
    }
    return { ...state, waitingRelease: false, capturedIndex: -1, captureKind: null }
  }

  if (target.kind === 'axis') {
    for (let i = 0; i < snapshot.axes.length; i++) {
      if (isAxisUsed(state.mapping, i)) continue
      const val = snapshot.axes[i] ?? 0
      if (!axisActive(val)) continue
      const mapping = cloneMapping(state.mapping)
      assignTarget(mapping, target, i)
      return {
        ...state,
        mapping,
        waitingRelease: true,
        capturedIndex: i,
        captureKind: 'axis',
      }
    }
    return state
  }

  // button
  for (let i = 0; i < snapshot.buttons.length; i++) {
    if (isButtonUsed(state.mapping, i)) continue
    const val = snapshot.buttons[i] ?? false
    if (!buttonActive(val)) continue
    const mapping = cloneMapping(state.mapping)
    assignTarget(mapping, target, i)
    return {
      ...state,
      mapping,
      waitingRelease: true,
      capturedIndex: i,
      captureKind: 'button',
    }
  }
  return state
}
