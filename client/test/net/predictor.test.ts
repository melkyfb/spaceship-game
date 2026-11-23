import { describe, expect, it } from 'vitest'
import { SHIP_CONFIG, type ShipCommand, type ShipState } from '@asteroids/shared'
import { Predictor } from '../../src/net/Predictor'

function makeShip(overrides: Partial<ShipState> = {}): ShipState {
  return {
    id: 'p1',
    name: 'Pilot',
    platform: 'PC',
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    shield: SHIP_CONFIG.MAX_SHIELD,
    energy: SHIP_CONFIG.MAX_ENERGY,
    score: 0,
    alive: true,
    invulnTimer: 0,
    lastProcessedTick: 0,
    ...overrides,
  }
}

function makeCmd(tick: number, overrides: Partial<ShipCommand> = {}): ShipCommand {
  return {
    tick,
    thrust: 0,
    strafeX: 0,
    strafeY: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    firePrimary: false,
    fireSecondary: false,
    boost: false,
    ...overrides,
  }
}

function cloneShip(s: ShipState): ShipState {
  return {
    ...s,
    pos: [s.pos[0], s.pos[1], s.pos[2]],
    vel: [s.vel[0], s.vel[1], s.vel[2]],
    rot: [s.rot[0], s.rot[1], s.rot[2], s.rot[3]],
    angVel: [s.angVel[0], s.angVel[1], s.angVel[2]],
  }
}

describe('Predictor', () => {
  it('reapplies unacked commands after authoritative reconciliation', () => {
    const predictor = new Predictor()
    const predicted = makeShip()
    const cmds = [makeCmd(1, { thrust: 1 }), makeCmd(2, { thrust: 1 }), makeCmd(3, { thrust: 1 })]

    for (const cmd of cmds) {
      predictor.predict(predicted, cmd)
    }

    // Authoritative snapshot processed tick 1 only, at the state after tick 1.
    const authoritativeBase = makeShip()
    const predictorForAuth = new Predictor()
    predictorForAuth.predict(authoritativeBase, makeCmd(1, { thrust: 1 }))
    authoritativeBase.lastProcessedTick = 1

    predictor.reconcile(predicted, authoritativeBase)

    // Should have replayed ticks 2,3 on top of authoritative tick-1 state.
    const replayCheck = cloneShip(authoritativeBase)
    const p2 = new Predictor()
    p2.predict(replayCheck, makeCmd(2, { thrust: 1 }))
    p2.predict(replayCheck, makeCmd(3, { thrust: 1 }))

    expect(predicted.lastProcessedTick).toBe(3)
    expect(predicted.pos[2]).toBeCloseTo(replayCheck.pos[2], 5)
    expect(predicted.pos[0]).toBeCloseTo(replayCheck.pos[0], 5)
    expect(predicted.pos[1]).toBeCloseTo(replayCheck.pos[1], 5)
  })

  it('smooths reconciliation error instead of teleporting display', () => {
    const predictor = new Predictor({ snapThreshold: 100, correctionDecayPerSec: 8 })
    const predicted = makeShip()
    predictor.predict(predicted, makeCmd(1, { thrust: 1 }))
    predictor.predict(predicted, makeCmd(2, { thrust: 1 }))

    const displayBefore = cloneShip(predicted)
    // Authoritative says we didn't move as far (server rejected/adjusted).
    const authoritative = makeShip({ lastProcessedTick: 2 })
    predictor.reconcile(predicted, authoritative)

    // Predicted base snapped to authoritative+replay(none), but display should be smoothed.
    expect(predicted.pos[2]).toBeCloseTo(0, 5)
    expect(predictor.getCorrectionDistance()).toBeGreaterThan(0.001)

    const display = cloneShip(predicted)
    predictor.getDisplayState(predicted, display)

    // Display should not teleport to reconciled position; it should be near old display.
    const jump = Math.hypot(
      display.pos[0] - displayBefore.pos[0],
      display.pos[1] - displayBefore.pos[1],
      display.pos[2] - displayBefore.pos[2],
    )
    const fullError = Math.hypot(
      predicted.pos[0] - displayBefore.pos[0],
      predicted.pos[1] - displayBefore.pos[1],
      predicted.pos[2] - displayBefore.pos[2],
    )
    expect(jump).toBeLessThan(fullError * 0.5)

    // After enough decay, correction should converge to near zero.
    for (let i = 0; i < 120; i++) predictor.decayCorrection(1 / 60)
    expect(predictor.getCorrectionDistance()).toBeLessThan(0.01)
  })

  it('snaps correction when error exceeds max snap threshold', () => {
    const predictor = new Predictor({ snapThreshold: 1, correctionDecayPerSec: 8 })
    const predicted = makeShip({ pos: [50, 0, 0] })
    const authoritative = makeShip({ pos: [0, 0, 0], lastProcessedTick: 0 })
    predictor.reconcile(predicted, authoritative)
    expect(predictor.getCorrectionDistance()).toBe(0)
    expect(predicted.pos[0]).toBeCloseTo(0, 5)
  })
})
