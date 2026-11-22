import { describe, expect, it } from 'vitest'
import { mapDesktopButtons, type DesktopButtonInput } from '../src/input/desktop-input-math'

function emptyInput(): DesktopButtonInput {
  return {
    keys: new Set<string>(),
    primaryMouse: false,
    secondaryMouse: false,
  }
}

describe('mapDesktopButtons', () => {
  it('maps W/S to thrust', () => {
    const forward = mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyW']) })
    expect(forward.thrust).toBe(1)
    expect(forward.strafeX).toBe(0)

    const backward = mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyS']) })
    expect(backward.thrust).toBe(-1)

    const both = mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyW', 'KeyS']) })
    expect(both.thrust).toBe(0)
  })

  it('maps A/D to strafeX', () => {
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyA']) }).strafeX).toBe(-1)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyD']) }).strafeX).toBe(1)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyA', 'KeyD']) }).strafeX).toBe(0)
  })

  it('maps Space/Ctrl to strafeY', () => {
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['Space']) }).strafeY).toBe(1)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['ControlLeft']) }).strafeY).toBe(-1)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['ControlRight']) }).strafeY).toBe(-1)
    expect(
      mapDesktopButtons({ ...emptyInput(), keys: new Set(['Space', 'ControlLeft']) }).strafeY,
    ).toBe(0)
  })

  it('maps Q/E to roll', () => {
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyQ']) }).roll).toBe(-1)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyE']) }).roll).toBe(1)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['KeyQ', 'KeyE']) }).roll).toBe(0)
  })

  it('maps Shift to boost', () => {
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['ShiftLeft']) }).boost).toBe(true)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['ShiftRight']) }).boost).toBe(true)
    expect(mapDesktopButtons(emptyInput()).boost).toBe(false)
  })

  it('maps LMB/RMB to firePrimary/fireSecondary', () => {
    expect(mapDesktopButtons({ ...emptyInput(), primaryMouse: true }).firePrimary).toBe(true)
    expect(mapDesktopButtons({ ...emptyInput(), secondaryMouse: true }).fireSecondary).toBe(true)
    expect(mapDesktopButtons(emptyInput()).firePrimary).toBe(false)
    expect(mapDesktopButtons(emptyInput()).fireSecondary).toBe(false)
  })

  it('maps Alt to freeLook flag', () => {
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['AltLeft']) }).freeLook).toBe(true)
    expect(mapDesktopButtons({ ...emptyInput(), keys: new Set(['AltRight']) }).freeLook).toBe(true)
    expect(mapDesktopButtons(emptyInput()).freeLook).toBe(false)
  })
})
