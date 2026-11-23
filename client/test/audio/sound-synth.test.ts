import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SoundSynth } from '../../src/audio/SoundSynth'

class MockAudioParam {
  value = 0
  setValueAtTime = vi.fn((v: number) => {
    this.value = v
    return this
  })
  linearRampToValueAtTime = vi.fn(() => this)
  exponentialRampToValueAtTime = vi.fn(() => this)
  cancelScheduledValues = vi.fn(() => this)
}

class MockAudioNode {
  connect = vi.fn(() => this)
  disconnect = vi.fn()
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine'
  frequency = new MockAudioParam()
  detune = new MockAudioParam()
  start = vi.fn()
  stop = vi.fn()
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam()
}

class MockPannerNode extends MockAudioNode {
  positionX = new MockAudioParam()
  positionY = new MockAudioParam()
  positionZ = new MockAudioParam()
  panningModel = 'HRTF'
  distanceModel = 'inverse'
  refDistance = 1
  maxDistance = 10000
  rolloffFactor = 1
}

class MockBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null = null
  loop = false
  start = vi.fn()
  stop = vi.fn()
}

class MockAudioBuffer {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  getChannelData = vi.fn(() => new Float32Array(this.length))
}

class MockAudioListener {
  positionX = new MockAudioParam()
  positionY = new MockAudioParam()
  positionZ = new MockAudioParam()
  forwardX = new MockAudioParam()
  forwardY = new MockAudioParam()
  forwardZ = new MockAudioParam()
  upX = new MockAudioParam()
  upY = new MockAudioParam()
  upZ = new MockAudioParam()
}

class MockAudioContext {
  static instances: MockAudioContext[] = []
  state: AudioContextState = 'suspended'
  currentTime = 0
  sampleRate = 44100
  destination = new MockAudioNode()
  listener = new MockAudioListener()

  constructor() {
    MockAudioContext.instances.push(this)
  }

  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  createOscillator = vi.fn(() => new MockOscillatorNode())
  createGain = vi.fn(() => new MockGainNode())
  createPanner = vi.fn(() => new MockPannerNode())
  createBuffer = vi.fn(
    (channels: number, length: number, sampleRate: number) =>
      new MockAudioBuffer(channels, length, sampleRate),
  )
  createBufferSource = vi.fn(() => new MockBufferSourceNode())
}

describe('SoundSynth', () => {
  beforeEach(() => {
    MockAudioContext.instances = []
    vi.stubGlobal('AudioContext', MockAudioContext)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resumeFromGesture creates/resumes context and playEvent does not throw without context', async () => {
    const synth = new SoundSynth()

    expect(() =>
      synth.playEvent({ kind: 'HIT', pos: [0, 0, 0], scale: 1 }),
    ).not.toThrow()

    await synth.resumeFromGesture()

    expect(MockAudioContext.instances).toHaveLength(1)
    expect(MockAudioContext.instances[0]!.resume).toHaveBeenCalledTimes(1)
    expect(MockAudioContext.instances[0]!.state).toBe('running')

    synth.dispose()
  })

  it('plays all event kinds after resume without throwing', async () => {
    const synth = new SoundSynth()
    await synth.resumeFromGesture()

    const kinds = ['EXPLOSION', 'HIT', 'PICKUP', 'PLAYER_DEATH', 'WAVE_CLEAR'] as const
    for (const kind of kinds) {
      expect(() => synth.playEvent({ kind, pos: [1, 2, 3], scale: 1 })).not.toThrow()
    }

    const ctx = MockAudioContext.instances[0]!
    const createdNodes =
      ctx.createOscillator.mock.calls.length +
      ctx.createBufferSource.mock.calls.length
    expect(createdNodes).toBeGreaterThan(0)

    synth.dispose()
  })

  it('degrades silently when AudioContext creation fails', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('AudioContext unavailable')
        }
      },
    )
    const synth = new SoundSynth()
    await expect(synth.resumeFromGesture()).resolves.toBeUndefined()
    expect(() => synth.playEvent({ kind: 'HIT', pos: [0, 0, 0], scale: 1 })).not.toThrow()
    synth.dispose()
  })

  it('dispose closes context and playEvent becomes silent', async () => {
    const synth = new SoundSynth()
    await synth.resumeFromGesture()
    const ctx = MockAudioContext.instances[0]!
    synth.dispose()
    expect(ctx.close).toHaveBeenCalledTimes(1)
    expect(() => synth.playEvent({ kind: 'EXPLOSION', pos: [0, 0, 0], scale: 1 })).not.toThrow()
  })
})
