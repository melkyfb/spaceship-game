import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyRadialDeadzone } from '../src/input/input-math'
import {
  assignTouchToSide,
  normalizeTouchJoystick,
  TouchInput,
  type TouchSideAssignment,
} from '../src/input/TouchInput'

type Listener = (event: any) => void

function createMockElement(tag = 'div') {
  const listeners = new Map<string, Set<Listener>>()
  const classes = new Set<string>()
  const el: any = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    type: '',
    style: {} as Record<string, string>,
    children: [] as any[],
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
    },
    setAttribute: vi.fn(),
    append: (...nodes: any[]) => {
      el.children.push(...nodes)
    },
    addEventListener: (type: string, fn: Listener) => {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add(fn)
    },
    removeEventListener: (type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn)
    },
    remove: vi.fn(),
    emit: (type: string, event: any) => {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
    _listeners: listeners,
    _classes: classes,
  }
  return el
}

function setupTouchDom() {
  const elements: any[] = []
  const body = createMockElement('body')
  const document = {
    body,
    createElement: vi.fn((tag: string) => {
      const el = createMockElement(tag)
      elements.push(el)
      return el
    }),
  }
  const window = { innerWidth: 1000, innerHeight: 800 }
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', window)
  return { document, window, elements, body }
}

function touch(identifier: number, clientX: number, clientY: number, target: any) {
  return { identifier, clientX, clientY, target }
}

function touchEvent(changed: any[], preventDefault = vi.fn()) {
  return {
    changedTouches: {
      length: changed.length,
      item: (i: number) => changed[i] ?? null,
      [Symbol.iterator]: function* () {
        for (const t of changed) yield t
      },
    },
    preventDefault,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('touch-input-math', () => {
  it('normalizes touch delta from center with radial deadzone and rescale', () => {
    const radius = 100
    const centerX = 200
    const centerY = 300

    expect(normalizeTouchJoystick(centerX, centerY, centerX + 10, centerY, radius, 0.15)).toEqual({
      x: 0,
      y: 0,
    })

    const edge = normalizeTouchJoystick(centerX, centerY, centerX + 100, centerY, radius, 0.15)
    expect(edge.x).toBeCloseTo(1)
    expect(edge.y).toBeCloseTo(0)

    const mid = normalizeTouchJoystick(centerX, centerY, centerX + 57.5, centerY, radius, 0.15)
    expect(mid.x).toBeCloseTo(0.5, 1)
    expect(mid.y).toBeCloseTo(0)

    const expected = applyRadialDeadzone(0.6, -0.8, 0.15)
    const diag = normalizeTouchJoystick(centerX, centerY, centerX + 60, centerY - 80, radius, 0.15)
    expect(diag.x).toBeCloseTo(expected.x)
    expect(diag.y).toBeCloseTo(expected.y)
  })

  it('assigns touches to left/right sides without crossing identifiers', () => {
    const width = 1000
    const assignments = new Map<number, TouchSideAssignment>()

    expect(assignTouchToSide(1, 100, width, assignments)).toBe('left')
    expect(assignTouchToSide(2, 900, width, assignments)).toBe('right')

    // Existing identifiers keep their side even if they cross the midpoint.
    expect(assignTouchToSide(1, 900, width, assignments)).toBe('left')
    expect(assignTouchToSide(2, 100, width, assignments)).toBe('right')

    // New touch on occupied side should not steal the other side's identifier.
    expect(assignTouchToSide(3, 100, width, assignments)).toBe('left')
  })
})

describe('TouchInput', () => {
  it('keeps FIRE held when same button receives multitouch and releases on owner end', () => {
    const { elements } = setupTouchDom()
    const input = new TouchInput()
    const attachEl = createMockElement('div')

    input.attach(attachEl as any)
    const overlay = elements.find((e) => e.className === 'touch-overlay')
    expect(overlay).toBeTruthy()
    const fireBtn = elements.find((e) => e.className === 'touch-btn touch-btn-fire')
    expect(fireBtn).toBeTruthy()

    overlay.emit('touchstart', touchEvent([touch(1, 900, 700, fireBtn)]))
    input.update(0)
    expect(input.getState().firePrimary).toBe(true)

    // Second finger touches same FIRE button - should not steal ownership.
    overlay.emit('touchstart', touchEvent([touch(2, 910, 710, fireBtn)]))
    input.update(0)
    expect(input.getState().firePrimary).toBe(true)

    // Releasing the non-owning finger must not release FIRE.
    overlay.emit('touchend', touchEvent([touch(2, 910, 710, fireBtn)]))
    input.update(0)
    expect(input.getState().firePrimary).toBe(true)

    // Releasing owner releases FIRE.
    overlay.emit('touchend', touchEvent([touch(1, 900, 700, fireBtn)]))
    input.update(0)
    expect(input.getState().firePrimary).toBe(false)

    input.dispose()
  })

  it('isolates joystick identifiers and resets on touchcancel', () => {
    const { elements } = setupTouchDom()
    const input = new TouchInput()
    const attachEl = createMockElement('div')
    input.attach(attachEl as any)
    const overlay = elements.find((e) => e.className === 'touch-overlay')

    // Left side touch starts joystick, right side starts right joystick.
    overlay.emit('touchstart', touchEvent([touch(10, 100, 400, overlay)]))
    overlay.emit('touchstart', touchEvent([touch(20, 900, 400, overlay)]))
    overlay.emit('touchmove', touchEvent([touch(10, 156, 400, overlay)])) // right on left stick
    overlay.emit('touchmove', touchEvent([touch(20, 900, 344, overlay)])) // up on right stick
    input.update(0)
    expect(input.getState().strafeX).toBeGreaterThan(0)
    expect(input.getState().pitch).toBeGreaterThan(0)

    // Moving with wrong identifier should not affect other stick.
    overlay.emit('touchmove', touchEvent([touch(20, 956, 400, overlay)]))
    input.update(0)
    expect(input.getState().strafeX).toBeGreaterThan(0) // left stick unchanged

    // Cancel right stick resets pitch/yaw but keeps left stick.
    overlay.emit('touchcancel', touchEvent([touch(20, 956, 400, overlay)]))
    input.update(0)
    expect(input.getState().pitch).toBe(0)
    expect(input.getState().yaw).toBe(0)
    expect(input.getState().strafeX).toBeGreaterThan(0)

    overlay.emit('touchcancel', touchEvent([touch(10, 156, 400, overlay)]))
    input.update(0)
    expect(input.getState().strafeX).toBe(0)
    expect(input.getState().thrust).toBe(0)

    input.dispose()
  })
})
