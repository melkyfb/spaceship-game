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

export function mapDesktopButtons(
  input: DesktopButtonInput,
  out?: DesktopButtonState,
): DesktopButtonState {
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

  const target = out ?? {
    thrust: 0,
    strafeX: 0,
    strafeY: 0,
    roll: 0,
    firePrimary: false,
    fireSecondary: false,
    boost: false,
    freeLook: false,
  }
  target.thrust = axis(backward, forward)
  target.strafeX = axis(left, right)
  target.strafeY = axis(down, up)
  target.roll = axis(rollLeft, rollRight)
  target.firePrimary = input.primaryMouse
  target.fireSecondary = input.secondaryMouse
  target.boost = boost
  target.freeLook = freeLook
  return target
}
