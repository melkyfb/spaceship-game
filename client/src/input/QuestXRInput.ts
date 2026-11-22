import { createNeutralQuestXRState, mapQuestXRInput, resetQuestXRState, type QuestXRMappingState } from './quest-xr-mapping'
import type { InputAdapter, InputState } from './types'

type HapticActuatorLike = {
  pulse?: (intensity: number, duration: number) => Promise<boolean> | void
  playEffect?: (type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number }) => Promise<string> | void
}

type HapticGamepadLike = Gamepad & {
  hapticActuators?: ReadonlyArray<HapticActuatorLike>
  vibrationActuator?: HapticActuatorLike
}

export interface QuestXRInputOptions {
  onRecenter?: () => void
}

const FIRE_HAPTIC = { intensity: 0.2, durationMs: 25 } as const
const MISSILE_HAPTIC = { intensity: 0.5, durationMs: 60 } as const
const SHIELD_DAMAGE_HAPTIC = { intensity: 0.85, durationMs: 150 } as const

function pulseActuator(actuator: HapticActuatorLike | undefined, intensity: number, durationMs: number): void {
  if (!actuator) return
  try {
    if (typeof actuator.pulse === 'function') {
      void actuator.pulse(intensity, durationMs)
      return
    }
    if (typeof actuator.playEffect === 'function') {
      void actuator.playEffect('dual-rumble', {
        duration: durationMs,
        strongMagnitude: intensity,
        weakMagnitude: intensity,
      })
    }
  } catch {
    // No-op: haptics unavailable or rejected.
  }
}

function pulseGamepad(gamepad: Gamepad | null | undefined, intensity: number, durationMs: number): void {
  if (!gamepad) return
  const gp = gamepad as HapticGamepadLike
  const actuators = gp.hapticActuators
  if (actuators && actuators.length > 0) {
    pulseActuator(actuators[0], intensity, durationMs)
    return
  }
  pulseActuator(gp.vibrationActuator, intensity, durationMs)
}

export class QuestXRInput implements InputAdapter {
  private readonly state: QuestXRMappingState = createNeutralQuestXRState()
  private session: XRSession | null = null
  private onRecenter: (() => void) | null
  private prevFirePrimary = false
  private prevFireSecondary = false
  private prevRecenter = false

  constructor(options: QuestXRInputOptions = {}) {
    this.onRecenter = options.onRecenter ?? null
  }

  attach(session: XRSession): void {
    if (this.session === session) return
    this.detach()
    this.session = session
    session.addEventListener('end', this.handleSessionEnd)
    this.prevFirePrimary = false
    this.prevFireSecondary = false
    this.prevRecenter = false
    resetQuestXRState(this.state)
  }

  detach(): void {
    const session = this.session
    if (!session) return
    session.removeEventListener('end', this.handleSessionEnd)
    this.session = null
    this.prevFirePrimary = false
    this.prevFireSecondary = false
    this.prevRecenter = false
    resetQuestXRState(this.state)
  }

  update(_dtOrFrame?: number | XRFrame): void {
    const session = this.session
    if (!session) {
      resetQuestXRState(this.state)
      return
    }

    // XRInputSourceArray is live; index by length to avoid allocations.
    const sources = session.inputSources
    mapQuestXRInput(sources as unknown as ReadonlyArray<{ handedness: 'left' | 'right' | 'none'; gamepad: Gamepad | null }>, this.state)

    const recenter = this.state.recenter
    this.state.recenter = false
    if (recenter && !this.prevRecenter) {
      this.onRecenter?.()
    }
    this.prevRecenter = recenter

    this.handleHapticTransitions(sources)
  }

  getState(): Readonly<InputState> {
    return this.state
  }

  dispose(): void {
    this.detach()
  }

  /** Safe no-op when haptics are unavailable. Exposed for M4 shield damage events. */
  pulseShieldDamage(): void {
    this.pulseAll(SHIELD_DAMAGE_HAPTIC.intensity, SHIELD_DAMAGE_HAPTIC.durationMs)
  }

  private readonly handleSessionEnd = (): void => {
    this.detach()
  }

  private handleHapticTransitions(sources: XRInputSourceArray): void {
    const fire = this.state.firePrimary
    const missile = this.state.fireSecondary

    if (fire && !this.prevFirePrimary) {
      this.pulseHandedness(sources, 'right', FIRE_HAPTIC.intensity, FIRE_HAPTIC.durationMs)
    }
    if (missile && !this.prevFireSecondary) {
      this.pulseHandedness(sources, 'right', MISSILE_HAPTIC.intensity, MISSILE_HAPTIC.durationMs)
    }

    this.prevFirePrimary = fire
    this.prevFireSecondary = missile
  }

  private pulseHandedness(
    sources: XRInputSourceArray,
    handedness: 'left' | 'right',
    intensity: number,
    durationMs: number,
  ): void {
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      if (!source || source.handedness !== handedness) continue
      pulseGamepad(source.gamepad, intensity, durationMs)
    }
  }

  private pulseAll(intensity: number, durationMs: number): void {
    const session = this.session
    if (!session) return
    const sources = session.inputSources
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      if (!source) continue
      pulseGamepad(source.gamepad, intensity, durationMs)
    }
  }
}
