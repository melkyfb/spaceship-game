import { describe, expect, it, vi } from 'vitest'
import { InputManager } from '../src/input/InputManager'
import type { InputAdapter, InputState } from '../src/input/types'

function makeAdapter(state: Partial<InputState> = {}): InputAdapter {
  return {
    update: vi.fn(),
    dispose: vi.fn(),
    getState: () => ({
      thrust: 0,
      strafeX: 0,
      strafeY: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      firePrimary: false,
      fireSecondary: false,
      boost: false,
      ...state,
    }),
  }
}

describe('InputManager', () => {
  it('returns a ShipCommand with the passed tick and default neutral state', () => {
    const manager = new InputManager()
    const cmd = manager.getCommand(42)
    expect(cmd).toEqual({
      tick: 42,
      thrust: 0,
      strafeX: 0,
      strafeY: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      firePrimary: false,
      fireSecondary: false,
      boost: false,
    })
  })

  it('pulls normalized state from the active adapter on update', () => {
    const manager = new InputManager()
    const adapter = makeAdapter({
      thrust: 1,
      strafeX: -0.5,
      strafeY: 0.25,
      yaw: 0.1,
      pitch: -0.2,
      roll: 0.3,
      firePrimary: true,
      fireSecondary: false,
      boost: true,
    })
    manager.setAdapter(adapter)
    manager.update(1 / 60)
    expect(adapter.update).toHaveBeenCalledWith(1 / 60)
    expect(manager.getCommand(7)).toEqual({
      tick: 7,
      thrust: 1,
      strafeX: -0.5,
      strafeY: 0.25,
      yaw: 0.1,
      pitch: -0.2,
      roll: 0.3,
      firePrimary: true,
      fireSecondary: false,
      boost: true,
    })
  })

  it('resets/clears state on dispose', () => {
    const manager = new InputManager()
    const adapter = makeAdapter({ thrust: 1, firePrimary: true, boost: true })
    manager.setAdapter(adapter)
    manager.update(1 / 60)
    manager.dispose()
    expect(adapter.dispose).toHaveBeenCalledTimes(1)
    const cmd = manager.getCommand(99)
    expect(cmd.thrust).toBe(0)
    expect(cmd.firePrimary).toBe(false)
    expect(cmd.boost).toBe(false)
    expect(cmd.tick).toBe(99)
  })

  it('replaces previous adapter and disposes it', () => {
    const manager = new InputManager()
    const a = makeAdapter({ thrust: 1 })
    const b = makeAdapter({ thrust: -1 })
    manager.setAdapter(a)
    manager.setAdapter(b)
    expect(a.dispose).toHaveBeenCalledTimes(1)
    manager.update(0)
    expect(manager.getCommand(1).thrust).toBe(-1)
  })

  it('resets command to neutral when adapter changes before next update', () => {
    const manager = new InputManager()
    const a = makeAdapter({
      thrust: 1,
      strafeX: -0.5,
      strafeY: 0.25,
      yaw: 0.1,
      pitch: -0.2,
      roll: 0.3,
      firePrimary: true,
      fireSecondary: true,
      boost: true,
    })
    const b = makeAdapter({ thrust: -1 })

    manager.setAdapter(a)
    manager.update(1 / 60)
    expect(manager.getCommand(7).thrust).toBe(1)

    manager.setAdapter(b)
    expect(manager.getCommand(8)).toEqual({
      tick: 8,
      thrust: 0,
      strafeX: 0,
      strafeY: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      firePrimary: false,
      fireSecondary: false,
      boost: false,
    })

    manager.update(1 / 60)
    expect(manager.getCommand(9).thrust).toBe(-1)
  })
})
