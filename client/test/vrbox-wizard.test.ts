import { describe, expect, it } from 'vitest'
import { createEmptyGamepadMapping, isMappingComplete } from '../src/input/gamepad-mapping'
import {
  advanceVRBoxWizard,
  createVRBoxWizardState,
  type VRBoxWizardSnapshot,
} from '../src/input/vrbox-wizard'

function snap(axes: number[], buttons: boolean[] = []): VRBoxWizardSnapshot {
  return { axes, buttons }
}

describe('vrbox-wizard', () => {
  it('captures axes sequentially and waits for release between substeps', () => {
    let w = createVRBoxWizardState(snap([0, 0, 0, 0]))
    expect(w.stage).toBe(1)
    expect(w.subStep).toBe(0)

    // Move axis 2 only - should capture strafeX but not advance thrust yet.
    w = advanceVRBoxWizard(w, snap([0, 0, 0.8, 0]))
    expect(w.stage).toBe(1)
    expect(w.subStep).toBe(0)
    expect(w.mapping.axes.strafeX).toBe(2)
    expect(w.waitingRelease).toBe(true)

    // Still held - should not capture thrust even if another axis moves.
    w = advanceVRBoxWizard(w, snap([0, 0.9, 0.8, 0]))
    expect(w.mapping.axes.thrust).toBe(-1)
    expect(w.stage).toBe(1)

    // Release captured axis - should allow next capture.
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0]))
    expect(w.waitingRelease).toBe(false)
    expect(w.subStep).toBe(1)

    // Move axis 1 for thrust.
    w = advanceVRBoxWizard(w, snap([0, -0.9, 0, 0]))
    expect(w.mapping.axes.thrust).toBe(1)
    expect(w.waitingRelease).toBe(true)

    // Release -> advances to stage 2.
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0]))
    expect(w.stage).toBe(2)
    expect(w.subStep).toBe(0)
  })

  it('completes full 3-step wizard with sequential button capture', () => {
    let w = createVRBoxWizardState(snap([0, 0, 0, 0], [false, false, false, false]))
    // Stage 1: strafe, release, thrust, release
    w = advanceVRBoxWizard(w, snap([0.9, 0, 0, 0], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0.9, 0, 0], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, false]))
    expect(w.stage).toBe(2)

    // Stage 2: yaw, release, pitch, release
    w = advanceVRBoxWizard(w, snap([0, 0, 0.9, 0], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0.9], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, false]))
    expect(w.stage).toBe(3)
    expect(w.subStep).toBe(0)

    // Stage 3: three buttons sequentially
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [true, false, false, false]))
    expect(w.mapping.buttons.firePrimary).toBe(0)
    expect(w.waitingRelease).toBe(true)
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [true, true, false, false]))
    expect(w.mapping.buttons.fireSecondary).toBe(-1) // still waiting release
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, true, false, false]))
    expect(w.mapping.buttons.fireSecondary).toBe(1)
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, false]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, true]))
    expect(w.mapping.buttons.boost).toBe(3)
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0], [false, false, false, false]))

    expect(w.stage).toBe(0)
    expect(isMappingComplete(w.mapping)).toBe(true)
  })

  it('does not capture the same axis index twice within mapping', () => {
    let w = createVRBoxWizardState(snap([0, 0, 0, 0]))
    w = advanceVRBoxWizard(w, snap([1, 0, 0, 0]))
    w = advanceVRBoxWizard(w, snap([0, 0, 0, 0])) // release
    // axis 0 already used for strafe; moving it again should not capture thrust
    w = advanceVRBoxWizard(w, snap([1, 0, 0, 0]))
    expect(w.mapping.axes.thrust).toBe(-1)
    w = advanceVRBoxWizard(w, snap([0, 1, 0, 0]))
    expect(w.mapping.axes.thrust).toBe(1)
  })
})
