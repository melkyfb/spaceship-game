import type { ShipCommand } from '@asteroids/shared'

export interface NormalizedAxes {
  thrust: number
  strafeX: number
  strafeY: number
  yaw: number
  pitch: number
  roll: number
}

export interface InputState extends NormalizedAxes {
  firePrimary: boolean
  fireSecondary: boolean
  boost: boolean
}

export interface InputAdapter {
  update(dt: number): void
  dispose(): void
  getState(): Readonly<InputState>
}

export type { ShipCommand }
