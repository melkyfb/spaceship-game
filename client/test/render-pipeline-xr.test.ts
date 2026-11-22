import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { RenderPipeline, type XrSessionLike, type XrSystemLike } from '../src/core/RenderPipeline'
import { XR_REFERENCE_SPACE_TYPE, XR_SESSION_MODE } from '../src/core/render-config'

interface FakeButton {
  id: string
  type: string
  textContent: string
  disabled: boolean
  style: Record<string, string>
  removed: boolean
  listeners: Map<string, Set<() => void>>
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  remove(): void
  click(): void
}

function createFakeButton(): FakeButton {
  const listeners = new Map<string, Set<() => void>>()
  return {
    id: '',
    type: '',
    textContent: '',
    disabled: false,
    style: {},
    removed: false,
    listeners,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener)
    },
    remove() {
      this.removed = true
    },
    click() {
      for (const listener of listeners.get('click') ?? []) listener()
    },
  }
}

function installDom(): { button: FakeButton; createElementSpy: ReturnType<typeof vi.fn>; container: { append: ReturnType<typeof vi.fn> } } {
  const button = createFakeButton()
  const createElementSpy = vi.fn((_tag: string) => button)
  vi.stubGlobal('document', {
    createElement: createElementSpy,
    body: { append: vi.fn() },
  })
  const container = { append: vi.fn() }
  return { button, createElementSpy, container }
}

function createSession(): XrSessionLike & { emitEnd(): void } {
  const endListeners = new Set<() => void>()
  return {
    addEventListener(type, listener) {
      if (type === 'end') endListeners.add(listener)
    },
    removeEventListener(type, listener) {
      if (type === 'end') endListeners.delete(listener)
    },
    end: vi.fn(async () => {}),
    emitEnd() {
      for (const listener of endListeners) listener()
    },
  }
}

function createXrSystem(options: { supported?: boolean; session?: XrSessionLike; fail?: boolean } = {}):
  XrSystemLike & { requestSessionSpy: ReturnType<typeof vi.fn>; isSessionSupportedSpy: ReturnType<typeof vi.fn> } {
  const session = options.session ?? createSession()
  const requestSessionSpy = vi.fn(async (_mode: string, _init?: { optionalFeatures?: string[] }): Promise<XrSessionLike> => {
    if (options.fail) throw new Error('XR permission denied')
    return session
  })
  const isSessionSupportedSpy = vi.fn(async (_mode: string): Promise<boolean> => options.supported ?? true)
  return {
    isSessionSupported: isSessionSupportedSpy,
    requestSession: requestSessionSpy,
    requestSessionSpy,
    isSessionSupportedSpy,
  }
}

interface FakeReferenceSpace {
  getOffsetReferenceSpace: ReturnType<typeof vi.fn>
}

interface FakeXr {
  enabled: boolean
  isPresenting: boolean
  setReferenceSpaceType: ReturnType<typeof vi.fn>
  setSession: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
  getReferenceSpace: ReturnType<typeof vi.fn>
  setReferenceSpace: ReturnType<typeof vi.fn>
  getCamera: ReturnType<typeof vi.fn>
}

function createRenderer(fakeXr: FakeXr): THREE.WebGLRenderer {
  return {
    xr: fakeXr,
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setRenderTarget: vi.fn(),
    render: vi.fn(),
  } as unknown as THREE.WebGLRenderer
}

function makePipeline(
  xr: XrSystemLike,
  fakeXr: FakeXr,
  container: { append: ReturnType<typeof vi.fn> },
): RenderPipeline {
  const renderer = createRenderer(fakeXr)
  const camera = new THREE.PerspectiveCamera()
  const cockpitRoot = new THREE.Group()
  const head = new THREE.Object3D()
  head.name = 'PilotHeadRig'
  cockpitRoot.add(head)
  return new RenderPipeline({
    renderer,
    camera,
    cockpitRoot,
    container: container as unknown as HTMLElement,
    xr,
  })
}

function createFakeReferenceSpace(): FakeReferenceSpace {
  return {
    getOffsetReferenceSpace: vi.fn((transform: unknown) => ({ kind: 'offset-space', transform })),
  }
}

function freshFakeXr(referenceSpace: FakeReferenceSpace | null = null): FakeXr {
  const xrCamera = new THREE.PerspectiveCamera()
  return {
    enabled: false,
    isPresenting: false,
    setReferenceSpaceType: vi.fn(),
    setSession: vi.fn(),
    getSession: vi.fn(() => null),
    getReferenceSpace: vi.fn(() => referenceSpace),
    setReferenceSpace: vi.fn(),
    getCamera: vi.fn(() => xrCamera),
  }
}

describe('RenderPipeline QUEST_3 / Enter VR flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('hides the button when immersive-vr is unsupported', async () => {
    const { createElementSpy, container } = installDom()
    const xr = createXrSystem({ supported: false })
    const pipeline = makePipeline(xr, freshFakeXr(), container)

    await pipeline.setMode('QUEST_3')

    expect(xr.isSessionSupportedSpy).toHaveBeenCalledWith(XR_SESSION_MODE)
    expect(createElementSpy).not.toHaveBeenCalled()
    expect(container.append).not.toHaveBeenCalled()
    expect(pipeline.getXrStatus()).toBe('unsupported')
  })

  it('shows the Enter VR button when immersive-vr is supported', async () => {
    const { button, createElementSpy, container } = installDom()
    const pipeline = makePipeline(createXrSystem(), freshFakeXr(), container)

    await pipeline.setMode('QUEST_3')

    expect(createElementSpy).toHaveBeenCalledWith('button')
    expect(button.id).toBe('enter-vr')
    expect(button.textContent).toBe('Enter VR')
    expect(button.disabled).toBe(false)
    expect(container.append).toHaveBeenCalledWith(button)
    expect(pipeline.getXrStatus()).toBe('ready')
  })

  it('requests immersive-vr from a user click and configures the local reference space', async () => {
    const { button, container } = installDom()
    const session = createSession()
    const xr = createXrSystem({ session })
    const fakeXr = freshFakeXr()
    const pipeline = makePipeline(xr, fakeXr, container)
    await pipeline.setMode('QUEST_3')

    button.click()
    await vi.waitFor(() => expect(pipeline.getXrStatus()).toBe('in-session'))

    expect(xr.requestSessionSpy).toHaveBeenCalledWith(XR_SESSION_MODE, {
      optionalFeatures: ['local-floor', 'hand-tracking', 'layers'],
    })
    expect(fakeXr.setReferenceSpaceType).toHaveBeenCalledWith(XR_REFERENCE_SPACE_TYPE)
    expect(fakeXr.setSession).toHaveBeenCalledWith(session)
    expect(button.disabled).toBe(true)
    expect(pipeline.getXrStatus()).toBe('in-session')
  })

  it('re-enables the button when the XR session ends', async () => {
    const { button, container } = installDom()
    const session = createSession()
    const pipeline = makePipeline(createXrSystem({ session }), freshFakeXr(), container)
    await pipeline.setMode('QUEST_3')

    button.click()
    await vi.waitFor(() => expect(pipeline.getXrStatus()).toBe('in-session'))
    session.emitEnd()

    expect(button.disabled).toBe(false)
    expect(button.textContent).toBe('Enter VR')
    expect(pipeline.getXrStatus()).toBe('ready')
  })

  it('surfaces a request failure in the UI and leaves the button recoverable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { button, container } = installDom()
    const xr = createXrSystem({ fail: true })
    const pipeline = makePipeline(xr, freshFakeXr(), container)
    await pipeline.setMode('QUEST_3')

    button.click()
    await vi.waitFor(() => expect(pipeline.getXrStatus()).toBe('error'))

    expect(button.disabled).toBe(false)
    expect(button.textContent).toMatch(/fail|retry/i)
    expect(xr.requestSessionSpy).toHaveBeenCalledTimes(1)

    // O botão continua habilitado: um segundo clique tenta novamente.
    button.click()
    await vi.waitFor(() => expect(xr.requestSessionSpy).toHaveBeenCalledTimes(2))
  })

  it('recenters WebXR reference space with yaw and x,y,z translation relative to pilot seat when presenting', async () => {
    class FakeXRRigidTransform {
      position: { x: number; y: number; z: number; w: number }
      orientation: { x: number; y: number; z: number; w: number }
      constructor(position?: { x?: number; y?: number; z?: number; w?: number }, orientation?: { x?: number; y?: number; z?: number; w?: number }) {
        this.position = {
          x: position?.x ?? 0,
          y: position?.y ?? 0,
          z: position?.z ?? 0,
          w: position?.w ?? 1,
        }
        this.orientation = {
          x: orientation?.x ?? 0,
          y: orientation?.y ?? 0,
          z: orientation?.z ?? 0,
          w: orientation?.w ?? 1,
        }
      }
    }
    vi.stubGlobal('XRRigidTransform', FakeXRRigidTransform)

    const { container } = installDom()
    const referenceSpace = createFakeReferenceSpace()
    const fakeXr = freshFakeXr(referenceSpace)
    fakeXr.isPresenting = true
    const pipeline = makePipeline(createXrSystem(), fakeXr, container)
    await pipeline.setMode('QUEST_3')

    const xrCamera = fakeXr.getCamera() as unknown as THREE.PerspectiveCamera
    xrCamera.position.set(1.2, 0.3, -0.8)
    xrCamera.quaternion.setFromEuler(new THREE.Euler(0.2, 0.7, -0.1, 'YXZ'))

    // Move PilotHeadRig away from base to ensure recenter restores it.
    const headRig = (pipeline as unknown as { pilotHeadRig: THREE.Object3D | null }).pilotHeadRig
    expect(headRig).not.toBeNull()
    headRig!.position.set(9, 9, 9)
    headRig!.quaternion.setFromEuler(new THREE.Euler(0, 1, 0))

    pipeline.recenter()

    expect(headRig!.position.x).toBeCloseTo(0)
    expect(headRig!.position.y).toBeCloseTo(0)
    expect(headRig!.position.z).toBeCloseTo(0)
    expect(headRig!.quaternion.x).toBeCloseTo(0)
    expect(headRig!.quaternion.y).toBeCloseTo(0)
    expect(headRig!.quaternion.z).toBeCloseTo(0)
    expect(headRig!.quaternion.w).toBeCloseTo(1)

    expect(referenceSpace.getOffsetReferenceSpace).toHaveBeenCalledTimes(1)
    const transform = referenceSpace.getOffsetReferenceSpace.mock.calls[0]?.[0] as FakeXRRigidTransform
    expect(transform.position.x).toBeCloseTo(1.2)
    expect(transform.position.y).toBeCloseTo(0.3)
    expect(transform.position.z).toBeCloseTo(-0.8)

    const expectedYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7)
    expect(transform.orientation.x).toBeCloseTo(expectedYaw.x)
    expect(transform.orientation.y).toBeCloseTo(expectedYaw.y)
    expect(transform.orientation.z).toBeCloseTo(expectedYaw.z)
    expect(transform.orientation.w).toBeCloseTo(expectedYaw.w)

    expect(fakeXr.setReferenceSpace).toHaveBeenCalledWith({
      kind: 'offset-space',
      transform,
    })
  })

  it('recenter does not touch WebXR reference space when not presenting', async () => {
    const { container } = installDom()
    const referenceSpace = createFakeReferenceSpace()
    const fakeXr = freshFakeXr(referenceSpace)
    fakeXr.isPresenting = false
    const pipeline = makePipeline(createXrSystem(), fakeXr, container)
    await pipeline.setMode('QUEST_3')

    const headRig = (pipeline as unknown as { pilotHeadRig: THREE.Object3D | null }).pilotHeadRig
    headRig!.position.set(1, 2, 3)
    pipeline.recenter()

    expect(headRig!.position.x).toBeCloseTo(0)
    expect(headRig!.position.y).toBeCloseTo(0)
    expect(headRig!.position.z).toBeCloseTo(0)
    expect(referenceSpace.getOffsetReferenceSpace).not.toHaveBeenCalled()
    expect(fakeXr.setReferenceSpace).not.toHaveBeenCalled()
  })
})
