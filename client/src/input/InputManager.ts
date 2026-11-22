import type { ShipCommand } from '@asteroids/shared'
import type { InputAdapter, InputState } from './types'

function createNeutralState(): InputState {
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
  }
}

export class InputManager {
  private adapter: InputAdapter | null = null
  private readonly state: InputState = createNeutralState()

  setAdapter(adapter: InputAdapter): void {
    if (this.adapter === adapter) return
    this.adapter?.dispose()
    this.adapter = adapter
  }

  update(dt: number): void {
    const adapter = this.adapter
    if (!adapter) return
    adapter.update(dt)
    const next = adapter.getState()
    this.state.thrust = next.thrust
    this.state.strafeX = next.strafeX
    this.state.strafeY = next.strafeY
    this.state.yaw = next.yaw
    this.state.pitch = next.pitch
    this.state.roll = next.roll
    this.state.firePrimary = next.firePrimary
    this.state.fireSecondary = next.fireSecondary
    this.state.boost = next.boost
  }

  getCommand(tick: number): ShipCommand {
    return {
      tick,
      thrust: this.state.thrust,
      strafeX: this.state.strafeX,
      strafeY: this.state.strafeY,
      yaw: this.state.yaw,
      pitch: this.state.pitch,
      roll: this.state.roll,
      firePrimary: this.state.firePrimary,
      fireSecondary: this.state.fireSecondary,
      boost: this.state.boost,
    }
  }

  dispose(): void {
    this.adapter?.dispose()
    this.adapter = null
    this.resetState()
  }

  private resetState(): void {
    this.state.thrust = 0
    this.state.strafeX = 0
    this.state.strafeY = 0
    this.state.yaw = 0
    this.state.pitch = 0
    this.state.roll = 0
    this.state.firePrimary = false
    this.state.fireSecondary = false
    this.state.boost = false
  }
}
