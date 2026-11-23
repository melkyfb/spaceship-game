export type SoundEventKind = 'EXPLOSION' | 'HIT' | 'PICKUP' | 'PLAYER_DEATH' | 'WAVE_CLEAR'

export interface SoundEvent {
  kind: SoundEventKind
  pos: readonly [number, number, number]
  scale: number
}

interface ListenerPose {
  position: readonly [number, number, number]
  forward: readonly [number, number, number]
  up: readonly [number, number, number]
}

const DEFAULT_FORWARD: readonly [number, number, number] = [0, 0, -1]
const DEFAULT_UP: readonly [number, number, number] = [0, 1, 0]
const DEFAULT_POS: readonly [number, number, number] = [0, 0, 0]

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

function safeScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return clamp(scale, 0.1, 8)
}

export class SoundSynth {
  private ctx: AudioContext | null = null
  private noiseBuffer: AudioBuffer | null = null
  private disposed = false
  private listener: ListenerPose = {
    position: DEFAULT_POS,
    forward: DEFAULT_FORWARD,
    up: DEFAULT_UP,
  }

  async resumeFromGesture(): Promise<void> {
    if (this.disposed) return
    try {
      if (this.ctx === null) {
        const Ctor = globalThis.AudioContext
        if (typeof Ctor === 'undefined') return
        this.ctx = new Ctor()
      }
      if (this.ctx.state !== 'running') {
        await this.ctx.resume()
      }
    } catch {
      // Autoplay / platform restrictions: degrade silently.
    }
  }

  updateListener(
    position: readonly [number, number, number],
    forward: readonly [number, number, number] = DEFAULT_FORWARD,
    up: readonly [number, number, number] = DEFAULT_UP,
  ): void {
    this.listener = { position, forward, up }
    const ctx = this.ctx
    if (!ctx || this.disposed) return
    try {
      this.applyListener(ctx)
    } catch {
      // Ignore listener update failures.
    }
  }

  playEvent(event: SoundEvent): void {
    const ctx = this.ctx
    if (!ctx || this.disposed || ctx.state !== 'running') return
    try {
      this.applyListener(ctx)
      const scale = safeScale(event.scale)
      switch (event.kind) {
        case 'EXPLOSION':
        case 'PLAYER_DEATH':
          this.playExplosion(ctx, event.pos, scale, event.kind === 'PLAYER_DEATH')
          break
        case 'HIT':
          this.playHit(ctx, event.pos, scale)
          break
        case 'PICKUP':
          this.playPickup(ctx, event.pos, scale)
          break
        case 'WAVE_CLEAR':
          this.playWaveClear(ctx, event.pos, scale)
          break
        default:
          break
      }
    } catch {
      // Audio failures must never break gameplay.
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const ctx = this.ctx
    this.ctx = null
    this.noiseBuffer = null
    if (ctx) {
      try {
        void ctx.close()
      } catch {
        // ignore
      }
    }
  }

  private applyListener(ctx: AudioContext): void {
    const l = ctx.listener
    const pos = this.listener.position
    const fwd = this.listener.forward
    const up = this.listener.up

    this.setParam(l.positionX, pos[0])
    this.setParam(l.positionY, pos[1])
    this.setParam(l.positionZ, pos[2])
    this.setParam(l.forwardX, fwd[0])
    this.setParam(l.forwardY, fwd[1])
    this.setParam(l.forwardZ, fwd[2])
    this.setParam(l.upX, up[0])
    this.setParam(l.upY, up[1])
    this.setParam(l.upZ, up[2])
  }

  private setParam(param: AudioParam | undefined, value: number): void {
    if (!param) return
    // Use direct assignment for broad compatibility; AudioParam automation not needed here.
    param.value = value
  }

  private createPanner(ctx: AudioContext, pos: readonly [number, number, number]): PannerNode {
    const panner = ctx.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 10
    panner.maxDistance = 500
    panner.rolloffFactor = 1
    this.setParam(panner.positionX, pos[0])
    this.setParam(panner.positionY, pos[1])
    this.setParam(panner.positionZ, pos[2])
    return panner
  }

  private connectOutput(ctx: AudioContext, node: AudioNode, panner: PannerNode, gain: GainNode): void {
    node.connect(gain)
    gain.connect(panner)
    panner.connect(ctx.destination)
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer
    }
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5))
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1
    }
    this.noiseBuffer = buffer
    return buffer
  }

  private playExplosion(
    ctx: AudioContext,
    pos: readonly [number, number, number],
    scale: number,
    fatal: boolean,
  ): void {
    const now = ctx.currentTime
    const duration = fatal ? 0.7 : 0.45
    const baseFreq = fatal ? 55 : 80
    const peak = clamp(0.35 * scale, 0.08, 0.9)

    const panner = this.createPanner(ctx, pos)

    // Noise burst
    const noise = ctx.createBufferSource()
    noise.buffer = this.getNoiseBuffer(ctx)
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(peak, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    this.connectOutput(ctx, noise, panner, noiseGain)
    noise.start(now)
    noise.stop(now + duration)

    // Low thump oscillator
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(baseFreq * (1.2 / Math.max(0.5, scale)), now)
    osc.frequency.exponentialRampToValueAtTime(28, now + duration)
    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(peak * 0.8, now)
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    this.connectOutput(ctx, osc, panner, oscGain)
    osc.start(now)
    osc.stop(now + duration)
  }

  private playHit(ctx: AudioContext, pos: readonly [number, number, number], scale: number): void {
    const now = ctx.currentTime
    const duration = 0.12
    const peak = clamp(0.18 * scale, 0.03, 0.5)
    const panner = this.createPanner(ctx, pos)

    const noise = ctx.createBufferSource()
    noise.buffer = this.getNoiseBuffer(ctx)
    const noiseGain = ctx.createGain()
    noiseGain.gain.setValueAtTime(peak, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    this.connectOutput(ctx, noise, panner, noiseGain)
    noise.start(now)
    noise.stop(now + duration)

    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(220 + scale * 40, now)
    osc.frequency.exponentialRampToValueAtTime(90, now + duration)
    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(peak * 0.35, now)
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    this.connectOutput(ctx, osc, panner, oscGain)
    osc.start(now)
    osc.stop(now + duration)
  }

  private playPickup(ctx: AudioContext, pos: readonly [number, number, number], scale: number): void {
    const now = ctx.currentTime
    const duration = 0.25
    const peak = clamp(0.12 * scale, 0.03, 0.35)
    const panner = this.createPanner(ctx, pos)

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(440, now)
    osc.frequency.exponentialRampToValueAtTime(880, now + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.001, now)
    gain.gain.linearRampToValueAtTime(peak, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration)
    this.connectOutput(ctx, osc, panner, gain)
    osc.start(now)
    osc.stop(now + duration)
  }

  private playWaveClear(ctx: AudioContext, pos: readonly [number, number, number], scale: number): void {
    const now = ctx.currentTime
    const peak = clamp(0.1 * scale, 0.03, 0.3)
    const panner = this.createPanner(ctx, pos)
    const notes = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
    for (let i = 0; i < notes.length; i++) {
      const freq = notes[i]
      if (freq === undefined) continue
      const start = now + i * 0.08
      const end = start + 0.22
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, start)
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.001, start)
      gain.gain.linearRampToValueAtTime(peak, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, end)
      this.connectOutput(ctx, osc, panner, gain)
      osc.start(start)
      osc.stop(end)
    }
  }
}
