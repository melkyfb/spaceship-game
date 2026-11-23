import { applyRadialDeadzone, applyResponseCurve, clampAxis } from './input-math'
import type { InputState } from './types'

export interface QuestXRGamepadLike {
  axes: ReadonlyArray<number>
  buttons: ReadonlyArray<{ pressed?: boolean; value?: number; touched?: boolean }>
}

export interface QuestXRInputSourceLike {
  handedness: 'left' | 'right' | 'none'
  gamepad: QuestXRGamepadLike | null
}

export interface QuestXRMappingState extends InputState {
  recenter: boolean
}

const DEADZONE = 0.15
const RESPONSE_EXPONENT = 1.6
const BUTTON_THRESHOLD = 0.5

export function createNeutralQuestXRState(): QuestXRMappingState {
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
    recenter: false,
  }
}

export function resetQuestXRState(state: QuestXRMappingState): void {
  state.thrust = 0
  state.strafeX = 0
  state.strafeY = 0
  state.yaw = 0
  state.pitch = 0
  state.roll = 0
  state.firePrimary = false
  state.fireSecondary = false
  state.boost = false
  state.recenter = false
}

function readButtonPressed(button: { pressed?: boolean; value?: number } | undefined): boolean {
  if (!button) return false
  if (button.pressed === true) return true
  const v = button.value
  return typeof v === 'number' && Number.isFinite(v) && v > BUTTON_THRESHOLD
}

function readButtonValue(button: { pressed?: boolean; value?: number } | undefined): number {
  if (!button) return 0
  const raw = typeof button.value === 'number' ? button.value : button.pressed ? 1 : 0
  if (!Number.isFinite(raw)) return 0
  if (raw <= 0) return 0
  if (raw >= 1) return 1
  return raw
}

function readAxis(axes: ReadonlyArray<number>, index: number): number {
  const v = axes[index]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

const stickScratch = { x: 0, y: 0 }

export function mapQuestXRInput(
  sources: ReadonlyArray<QuestXRInputSourceLike>,
  out: QuestXRMappingState,
): QuestXRMappingState {
  resetQuestXRState(out)

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    if (!source) continue
    const gp = source.gamepad
    if (!gp) continue
    const axes = gp.axes
    const buttons = gp.buttons

    if (source.handedness === 'left') {
      // Translação: stick X = strafeX, stick Y = thrust (forward/up = -Y)
      applyRadialDeadzone(readAxis(axes, 2), readAxis(axes, 3), DEADZONE, stickScratch)
      out.strafeX = clampAxis(stickScratch.x)
      out.thrust = clampAxis(-stickScratch.y)

      // strafeY: trigger (btn 0) up, Y button (btn 5) down - analog/digital values
      const strafeUp = readButtonValue(buttons[0])
      const strafeDown = readButtonValue(buttons[5])
      out.strafeY = clampAxis(strafeUp - strafeDown)

      // boost: squeeze (btn 1), recenter: X (btn 4)
      if (readButtonPressed(buttons[1])) out.boost = true
      if (readButtonPressed(buttons[4])) out.recenter = true
      continue
    }

    if (source.handedness === 'right') {
      // Rotação: stick X = yaw, stick Y = pitch (up = -Y), curve 1.6; seguir cursor: direita = yaw negativo
      applyRadialDeadzone(readAxis(axes, 2), readAxis(axes, 3), DEADZONE, stickScratch)
      out.yaw = clampAxis(applyResponseCurve(clampAxis(-stickScratch.x), RESPONSE_EXPONENT))
      out.pitch = clampAxis(applyResponseCurve(clampAxis(-stickScratch.y), RESPONSE_EXPONENT))

      // Triggers: trigger (btn 0) = firePrimary, squeeze (btn 1) = fireSecondary/missile
      if (readButtonPressed(buttons[0])) out.firePrimary = true
      if (readButtonPressed(buttons[1])) out.fireSecondary = true
    }
  }

  return out
}
