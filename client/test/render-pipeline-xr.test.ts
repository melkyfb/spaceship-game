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

interface FakeXr {
  enabled: boolean
  isPresenting: boolean
  setReferenceSpaceType: ReturnType<typeof vi.fn>
  setSession: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
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

function freshFakeXr(): FakeXr {
  return {
    enabled: false,
    isPresenting: false,
    setReferenceSpaceType: vi.fn(),
    setSession: vi.fn(),
    getSession: vi.fn(() => null),
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
})
