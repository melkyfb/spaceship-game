export interface DesktopButtonInput {
  keys: ReadonlySet<string>
  primaryMouse: boolean
  secondaryMouse: boolean
}

export interface DesktopButtonState {
  thrust: number
  strafeX: number
  strafeY: number
  roll: number
  firePrimary: boolean
  fireSecondary: boolean
  boost: boolean
  freeLook: boolean
}

function axis(negative: boolean, positive: boolean): number {
  if (negative === positive) return 0
  return positive ? 1 : -1
}

export function mapDesktopButtons(input: DesktopButtonInput): DesktopButtonState {
  const keys = input.keys
  const forward = keys.has('KeyW')
  const backward = keys.has('KeyS')
  const left = keys.has('KeyA')
  const right = keys.has('KeyD')
  const up = keys.has('Space')
  const down = keys.has('ControlLeft') || keys.has('ControlRight')
  const rollLeft = keys.has('KeyQ')
  const rollRight = keys.has('KeyE')
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight')
  const freeLook = keys.has('AltLeft') || keys.has('AltRight')

  return {
    thrust: axis(backward, forward),
    strafeX: axis(left, right),
    strafeY: axis(down, up),
    roll: axis(rollLeft, rollRight),
    firePrimary: input.primaryMouse,
    fireSecondary: input.secondaryMouse,
    boost,
    freeLook,
  }
}
