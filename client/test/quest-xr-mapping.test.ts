import { describe, expect, it, vi } from 'vitest'
import { applyResponseCurve } from '../src/input/input-math'
import {
  createNeutralQuestXRState,
  mapQuestXRInput,
  type QuestXRGamepadLike,
  type QuestXRInputSourceLike,
} from '../src/input/quest-xr-mapping'

function makeGamepad(
  overrides: Partial<{
    axes: readonly number[]
    buttons: ReadonlyArray<{ pressed?: boolean; value?: number; touched?: boolean }>
  }> = {},
): QuestXRGamepadLike {
  const axes = overrides.axes ?? [0, 0, 0, 0]
  const buttons =
    overrides.buttons ?? Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
  return { axes, buttons }
}

function makeSource(
  handedness: 'left' | 'right' | 'none',
  gamepad: QuestXRGamepadLike | null = makeGamepad(),
): QuestXRInputSourceLike {
  return { handedness, gamepad }
}

describe('quest-xr-mapping', () => {
  it('maps left stick to translation (strafeX/thrust) with deadzone', () => {
    const state = createNeutralQuestXRState()
    mapQuestXRInput([makeSource('left', makeGamepad({ axes: [0, 0, 0.5, -0.8] }))], state)
    expect(state.strafeX).toBeGreaterThan(0)
    expect(state.thrust).toBeGreaterThan(0)

    const small = createNeutralQuestXRState()
    mapQuestXRInput([makeSource('left', makeGamepad({ axes: [0, 0, 0.05, -0.05] }))], small)
    expect(small.strafeX).toBe(0)
    expect(small.thrust).toBe(0)
  })

  it('maps right stick to yaw/pitch with curve 1.6', () => {
    const state = createNeutralQuestXRState()
    mapQuestXRInput([makeSource('right', makeGamepad({ axes: [0, 0, 0.6, -0.4] }))], state)
    expect(state.yaw).not.toBe(0)
    expect(state.pitch).not.toBe(0)
    // response curve 1.6 reduces magnitude for sub-unit input
    expect(Math.abs(state.yaw)).toBeLessThan(0.6)

    const full = createNeutralQuestXRState()
    mapQuestXRInput([makeSource('right', makeGamepad({ axes: [0, 0, 1, 0] }))], full)
    expect(full.yaw).toBeCloseTo(applyResponseCurve(1, 1.6))
    expect(full.pitch).toBeCloseTo(0)
  })

  it('maps right controller triggers to fire/missile', () => {
    const state = createNeutralQuestXRState()
    const right = makeGamepad()
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
    buttons[0] = { pressed: true, value: 1 } // trigger -> firePrimary
    buttons[1] = { pressed: true, value: 1 } // squeeze -> fireSecondary/missile
    right.buttons = buttons
    mapQuestXRInput([makeSource('right', right)], state)
    expect(state.firePrimary).toBe(true)
    expect(state.fireSecondary).toBe(true)
  })

  it('maps left controller boost, recenter, and strafeY controls', () => {
    const state = createNeutralQuestXRState()
    const buttons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
    buttons[1] = { pressed: true, value: 1 } // squeeze -> boost
    buttons[4] = { pressed: true, value: 1 } // X -> recenter
    buttons[0] = { pressed: false, value: 0.7 } // trigger -> strafeY up
    mapQuestXRInput([makeSource('left', makeGamepad({ buttons }))], state)
    expect(state.boost).toBe(true)
    expect(state.recenter).toBe(true)
    expect(state.strafeY).toBeGreaterThan(0)

    const down = createNeutralQuestXRState()
    const downButtons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
    downButtons[5] = { pressed: false, value: 0.6 } // Y -> strafeY down
    mapQuestXRInput([makeSource('left', makeGamepad({ buttons: downButtons }))], down)
    expect(down.strafeY).toBeLessThan(0)
  })

  it('resets to neutral when sources are absent or gamepad missing', () => {
    const state = createNeutralQuestXRState()
    state.thrust = 1
    state.firePrimary = true
    state.recenter = true
    mapQuestXRInput([], state)
    expect(state.thrust).toBe(0)
    expect(state.firePrimary).toBe(false)
    expect(state.recenter).toBe(false)

    const state2 = createNeutralQuestXRState()
    state2.strafeX = 1
    mapQuestXRInput([makeSource('left', null)], state2)
    expect(state2.strafeX).toBe(0)
  })
})

import { QuestXRInput } from '../src/input/QuestXRInput'

function createMockXRSession(sources: any[] = []) {
  const listeners = new Map<string, Set<() => void>>()
  const session = {
    inputSources: sources,
    addEventListener(type: string, fn: () => void) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(fn)
    },
    removeEventListener(type: string, fn: () => void) {
      listeners.get(type)?.delete(fn)
    },
    emit(type: string) {
      for (const fn of listeners.get(type) ?? []) fn()
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0
    },
  }
  return session
}

function makeXRSource(handedness: 'left' | 'right', gamepad: any) {
  return { handedness, gamepad }
}

function makeXRGamepad(opts: { axes?: number[]; buttons?: any[]; hapticActuators?: any[] } = {}) {
  return {
    axes: opts.axes ?? [0, 0, 0, 0],
    buttons: opts.buttons ?? Array.from({ length: 6 }, () => ({ pressed: false, value: 0 })),
    hapticActuators: opts.hapticActuators,
  }
}

describe('QuestXRInput', () => {
  it('attaches, reads XR input sources, and updates state', () => {
    const onRecenter = vi.fn()
    const input = new QuestXRInput({ onRecenter })
    const left = makeXRGamepad({ axes: [0, 0, 0.4, -1] })
    const rightButtons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
    rightButtons[0] = { pressed: true, value: 1 }
    const right = makeXRGamepad({ axes: [0, 0, 1, 0], buttons: rightButtons })
    const session = createMockXRSession([makeXRSource('left', left), makeXRSource('right', right)])

    input.attach(session as any)
    input.update(1 / 72)
    const state = input.getState()
    expect(state.strafeX).toBeGreaterThan(0)
    expect(state.thrust).toBeGreaterThan(0)
    expect(state.yaw).toBeCloseTo(applyResponseCurve(1, 1.6))
    expect(state.firePrimary).toBe(true)
    expect(onRecenter).not.toHaveBeenCalled()
  })

  it('fires recenter on rising edge and cleans up on session end', () => {
    const onRecenter = vi.fn()
    const input = new QuestXRInput({ onRecenter })
    const leftButtons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
    leftButtons[4] = { pressed: true, value: 1 } // X recenter
    const session = createMockXRSession([makeXRSource('left', makeXRGamepad({ buttons: leftButtons }))])

    input.attach(session as any)
    input.update(1 / 72)
    input.update(1 / 72) // held - should not fire again
    expect(onRecenter).toHaveBeenCalledTimes(1)

    session.emit('end')
    expect(session.listenerCount('end')).toBe(0)
    input.update(1 / 72)
    expect(input.getState().thrust).toBe(0)
  })

  it('is safe when haptics are unavailable and pulses on fire/missile', () => {
    const pulse = vi.fn()
    const rightButtons = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
    const right = makeXRGamepad({ buttons: rightButtons, hapticActuators: [{ pulse }] })
    const session = createMockXRSession([makeXRSource('right', right)])
    const input = new QuestXRInput()
    input.attach(session as any)

    // no haptics object - should be no-op
    const noHapticsSession = createMockXRSession([makeXRSource('right', makeXRGamepad())])
    const input2 = new QuestXRInput()
    input2.attach(noHapticsSession as any)
    const b = Array.from({ length: 6 }, () => ({ pressed: false, value: 0 }))
    b[0] = { pressed: true, value: 1 }
    ;(noHapticsSession.inputSources[0] as any).gamepad.buttons = b
    expect(() => input2.update(1 / 72)).not.toThrow()

    // rising edge fire
    rightButtons[0] = { pressed: true, value: 1 }
    input.update(1 / 72)
    expect(pulse).toHaveBeenCalledWith(0.2, 25)
    input.update(1 / 72) // held, no repeat
    expect(pulse).toHaveBeenCalledTimes(1)

    // missile rising edge
    rightButtons[1] = { pressed: true, value: 1 }
    input.update(1 / 72)
    expect(pulse).toHaveBeenCalledWith(0.5, 60)

    // shield damage safe no-op API
    expect(() => input.pulseShieldDamage()).not.toThrow()
  })

  it('pulses shield damage haptics with expected intensity and duration', () => {
    const pulse = vi.fn()
    const session = createMockXRSession([
      makeXRSource('left', makeXRGamepad({ hapticActuators: [{ pulse }] })),
      makeXRSource('right', makeXRGamepad()),
    ])
    const input = new QuestXRInput()
    input.attach(session as any)

    input.pulseShieldDamage()

    expect(pulse).toHaveBeenCalledWith(0.85, 150)
  })
})

