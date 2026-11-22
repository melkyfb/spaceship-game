import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopInput } from '../src/input/DesktopInput'
import { applyRadialDeadzone, applyResponseCurve } from '../src/input/input-math'

type Listener = (event: any) => void

function createEventTarget() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    listeners,
    addEventListener(type: string, fn: Listener) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(fn)
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn)
    },
    emit(type: string, event: any = {}) {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
  }
}

function setupDom() {
  const windowTarget = createEventTarget()
  const documentTarget = createEventTarget()
  const target = {
    ...createEventTarget(),
    pointerLockElement: null as any,
    requestPointerLock: vi.fn(() => {
      ;(document as any).pointerLockElement = target
      documentTarget.emit('pointerlockchange', {})
      return Promise.resolve()
    }),
  }

  const document = {
    ...documentTarget,
    pointerLockElement: null as any,
    exitPointerLock: vi.fn(() => {
      ;(document as any).pointerLockElement = null
      documentTarget.emit('pointerlockchange', {})
    }),
  }

  const window = { ...windowTarget }
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  vi.stubGlobal('navigator', { getGamepads: () => [] })
  return { window, document, target }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DesktopInput', () => {
  it('maps keyboard state to normalized ship command axes', () => {
    const { window, target } = setupDom()
    const input = new DesktopInput()
    input.attach(target as any)

    window.emit('keydown', { code: 'KeyW', preventDefault: vi.fn() })
    window.emit('keydown', { code: 'KeyD', preventDefault: vi.fn() })
    window.emit('keydown', { code: 'Space', preventDefault: vi.fn() })
    window.emit('keydown', { code: 'KeyE', preventDefault: vi.fn() })
    window.emit('keydown', { code: 'ShiftLeft', preventDefault: vi.fn() })
    target.emit('mousedown', { button: 0 })
    target.emit('mousedown', { button: 2 })

    input.update(1 / 60)
    const state = input.getState()
    expect(state.thrust).toBe(1)
    expect(state.strafeX).toBe(1)
    expect(state.strafeY).toBe(1)
    expect(state.roll).toBe(1)
    expect(state.boost).toBe(true)
    expect(state.firePrimary).toBe(true)
    expect(state.fireSecondary).toBe(true)
    input.dispose()
  })

  it('applies 1.6 response curve to mouse yaw/pitch and resets delta each poll', () => {
    const { document, target } = setupDom()
    const input = new DesktopInput()
    input.attach(target as any)
    target.emit('mousedown', { button: 0 }) // requests pointer lock
    expect((document as any).pointerLockElement).toBe(target)

    target.emit('mousemove', { movementX: 100, movementY: -50 })
    input.poll()
    const state = input.getState()
    const expectedYaw = applyResponseCurve(Math.max(-1, Math.min(1, 100 * 0.0025)), 1.6)
    const expectedPitch = applyResponseCurve(Math.max(-1, Math.min(1, 50 * 0.0025)), 1.6)
    expect(state.yaw).toBeCloseTo(expectedYaw)
    expect(state.pitch).toBeCloseTo(expectedPitch)

    input.poll()
    expect(input.getState().yaw).toBe(0)
    expect(input.getState().pitch).toBe(0)
    input.dispose()
  })

  it('Alt free-look exposes flag and does not drive ship yaw/pitch', () => {
    const { window, target } = setupDom()
    const input = new DesktopInput()
    input.attach(target as any)
    target.emit('mousedown', { button: 0 })
    window.emit('keydown', { code: 'AltLeft', preventDefault: vi.fn() })
    target.emit('mousemove', { movementX: 100, movementY: -40 })

    input.poll()
    expect(input.isFreeLookActive()).toBe(true)
    expect(input.getState().yaw).toBe(0)
    expect(input.getState().pitch).toBe(0)
    const look = input.getFreeLookState()
    expect(look.active).toBe(true)
    expect(look.deltaYaw).not.toBe(0)
    expect(look.deltaPitch).not.toBe(0)

    window.emit('keyup', { code: 'AltLeft' })
    input.poll()
    expect(input.isFreeLookActive()).toBe(false)
    expect(input.getFreeLookState().yaw).toBe(0)
    expect(input.getFreeLookState().pitch).toBe(0)
    input.dispose()
  })

  it('resets axes on window blur', () => {
    const { window, target } = setupDom()
    const input = new DesktopInput()
    input.attach(target as any)
    window.emit('keydown', { code: 'KeyW', preventDefault: vi.fn() })
    target.emit('mousedown', { button: 0 })
    input.poll()
    expect(input.getState().thrust).toBe(1)

    window.emit('blur', {})
    input.poll()
    const state = input.getState()
    expect(state.thrust).toBe(0)
    expect(state.firePrimary).toBe(false)
    expect(state.boost).toBe(false)
    input.dispose()
  })

  it('resets axes on pointer lock loss', () => {
    const { window, document, target } = setupDom()
    const input = new DesktopInput()
    input.attach(target as any)
    target.emit('mousedown', { button: 0 })
    window.emit('keydown', { code: 'KeyW', preventDefault: vi.fn() })
    target.emit('mousemove', { movementX: 100, movementY: 0 })
    input.poll()
    expect(input.getState().thrust).toBe(1)

    ;(document as any).pointerLockElement = null
    document.emit('pointerlockchange', {})
    input.poll()
    expect(input.getState().thrust).toBe(0)
    expect(input.getState().yaw).toBe(0)
    input.dispose()
  })

  it('polls standard gamepad simultaneously and applies deadzone/curve', () => {
    setupDom()
    const input = new DesktopInput()
    const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }))
    buttons[7] = { pressed: true, value: 1 }
    buttons[0] = { pressed: true, value: 1 }
    const gamepad = {
      connected: true,
      axes: [0, 0, 0.5, -0.5],
      buttons,
    } as unknown as Gamepad

    input.poll(gamepad)
    const state = input.getState()
    expect(state.thrust).toBe(1)
    expect(state.firePrimary).toBe(true)
    const rightStick = applyRadialDeadzone(0.5, -0.5, 0.15)
    const expectedYaw = applyResponseCurve(rightStick.x, 1.6)
    const expectedPitch = applyResponseCurve(-rightStick.y, 1.6)
    expect(state.yaw).toBeCloseTo(expectedYaw)
    expect(state.pitch).toBeCloseTo(expectedPitch)
    input.dispose()
  })
})
