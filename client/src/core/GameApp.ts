import * as THREE from 'three'
import type { ClientMessage, PlatformMode, ServerMessage, ShipCommand, ShipState } from '@asteroids/shared'
import { WORLD_CONFIG } from '@asteroids/shared'
import { CockpitRig } from './CockpitRig'
import { RenderPipeline, type RenderMode } from './RenderPipeline'
import { createStarfield, recenterStarfield } from './Starfield'
import { SoundSynth } from '../audio/SoundSynth'
import { AsteroidPool } from '../entities/AsteroidPool'
import { EnemyPool } from '../entities/EnemyShip'
import { ParticleSystem } from '../entities/ParticleSystem'
import { ProjectilePool } from '../entities/ProjectilePool'
import { ShipPool } from '../entities/ShipPool'
import { DesktopInput } from '../input/DesktopInput'
import { InputManager } from '../input/InputManager'
import { QuestXRInput } from '../input/QuestXRInput'
import { TouchInput } from '../input/TouchInput'
import { VRBoxInput } from '../input/VRBoxInput'
import { ClockSync } from '../net/ClockSync'
import { Interpolator } from '../net/Interpolator'
import { LocalTransport } from '../net/LocalTransport'
import { Predictor } from '../net/Predictor'
import { WsTransport } from '../net/WsTransport'
import type { ITransport } from '../net/ITransport'
import {
  loadLocalLeaderboard,
  recordLocalScore,
  type RankedLocalLeaderboardEntry,
} from '../state/leaderboard-local'
import { readPlayerName, readPlayerToken, writePlayerName, writePlayerToken } from '../state/player-profile'
import { DiegeticHUD } from '../ui/DiegeticHUD'
import { LeaderboardHud } from '../ui/LeaderboardHud'
import { OffscreenPips } from '../ui/OffscreenPips'
import { RespawnOverlay } from '../ui/RespawnOverlay'
import { StartScreen, type StartScreenMode } from '../ui/StartScreen'
import type { Contact, HudState } from '../ui/hud-math'
import {
  isRespawnReady,
  respawnCountdownSec,
  selectKillerCameraTarget,
  shouldRecordScore,
  type KillerCameraEntityLike,
  type KillerCameraTarget,
} from './m5-flow'

export type GameMode = 'TRAINING' | 'MULTIPLAYER'

const STAR_COUNT = 2000
const STARFIELD_SPIN_RAD_PER_SEC = 0.006
const FREE_LOOK_MAX_YAW = 1.2
const FREE_LOOK_MAX_PITCH = 0.8
const MAX_HUD_CONTACTS = 16
const COMMAND_BUFFER_SIZE = 6
const PING_INTERVAL_SEC = 1.0

function isMobileTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const touchPoints = navigator.maxTouchPoints ?? 0
  if (touchPoints <= 0) return false
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches
  }
  return true
}

function platformModeForRuntime(): PlatformMode {
  return isMobileTouchDevice() ? 'ANDROID_FLAT' : 'PC'
}

function toWsUrl(locationLike: { protocol: string; host: string }): string {
  const proto = locationLike.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${locationLike.host}/ws`
}

function defaultMultiplayerUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws'
  return toWsUrl(window.location)
}

export interface GameAppOptions {
  multiplayerUrl?: string
}

export class GameApp {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer

  private readonly container: HTMLElement
  private readonly cockpit: CockpitRig
  private readonly starfield: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly pipeline: RenderPipeline
  private readonly hud: DiegeticHUD
  private readonly pips: OffscreenPips
  private readonly hudState: HudState
  private readonly hudContacts: Contact[] = []
  private readonly contactPool: Contact[] = []

  private readonly clock = new THREE.Clock()
  private readonly inputManager = new InputManager()
  private readonly desktopInput = new DesktopInput()
  private readonly touchInput = new TouchInput()
  private readonly vrBoxInput = new VRBoxInput()
  private readonly questXrInput = new QuestXRInput({ onRecenter: () => this.recenter() })
  private readonly useTouchInput = isMobileTouchDevice()
  private desktopInputAttached = false
  private touchInputAttached = false
  private vrBoxInputAttached = false
  private questXrSessionAttached = false
  private readonly vrBoxHeadQuat = { x: 0, y: 0, z: 0, w: 1 }
  private inputSyncToken = 0
  private running = false
  private disposed = false
  private shakeTimeRemaining = 0
  private shakeDuration = 0
  private shakeIntensity = 0
  private lastLocalShield = 100

  private readonly transport: { current: ITransport | null } = { current: null }
  private unsubscribeTransport: (() => void) | null = null
  private transportReady = false
  private localPlayerId: string | null = null
  private localPlayerToken: string | null = null
  private commandTick = 1
  private readonly commandBuffer: ShipCommand[] = []
  private readonly commandBatchOut: ShipCommand[] = []
  private latestSnapshot: (ServerMessage & { t: 'SNAPSHOT' }) | null = null
  private appliedSnapshot: (ServerMessage & { t: 'SNAPSHOT' }) | null = null

  private mode: GameMode | null = null
  private sessionActive = false
  private deathActive = false
  private deathElapsedSec = 0
  private deathDelaySec: number = WORLD_CONFIG.RESPAWN_DELAY_SEC
  private killerTarget: KillerCameraTarget | null = null
  private readonly killerEntities: KillerCameraEntityLike[] = []
  private readonly spectatorTargetPos = new THREE.Vector3()
  private readonly spectatorDesiredPos = new THREE.Vector3()
  private readonly spectatorLookAt = new THREE.Vector3()
  private readonly spectatorOrbitAxis = new THREE.Vector3(0, 1, 0)
  private spectatorOrbitAngle = 0
  private currentRunScore = 0
  private currentRunWave = 1
  private currentLeaderboardRank: number | null = null
  private bestRecordedRank: number | null = null
  private bestRecordedScore: number | null = null
  private lastRecordedScoreForRun: number | null = null
  private lastRecordedScoreKey: string | null = null
  private pendingQuitToMenu = false
  private pingTimerSec = 0

  private readonly clockSync = new ClockSync()
  private readonly predictor = new Predictor()
  private readonly interpolator = new Interpolator()
  private predictedLocalShip: ShipState | null = null
  private readonly displayLocalShip: ShipState = {
    id: '',
    name: '',
    platform: 'PC',
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    rot: [0, 0, 0, 1],
    angVel: [0, 0, 0],
    shield: 100,
    energy: 100,
    score: 0,
    alive: true,
    invulnTimer: 0,
    lastProcessedTick: 0,
  }
  private readonly interpShipState = { pos: [0, 0, 0] as [number, number, number], rot: [0, 0, 0, 1] as [number, number, number, number] }
  private readonly remoteShipIds: Array<string | number> = []

  private readonly startScreen: StartScreen
  private readonly respawnOverlay: RespawnOverlay
  private readonly leaderboardHud: LeaderboardHud
  private readonly multiplayerUrl: string

  private readonly asteroidPool: AsteroidPool
  private readonly projectilePool: ProjectilePool
  private readonly enemyPool: EnemyPool
  private readonly shipPool: ShipPool
  private readonly particleSystem: ParticleSystem
  private readonly soundSynth = new SoundSynth()
  private readonly audioListenerPos = new THREE.Vector3()
  private readonly audioListenerDir = new THREE.Vector3()
  private readonly audioListenerUp = new THREE.Vector3()
  private readonly audioListenerQuat = new THREE.Quaternion()
  private readonly audioListenerPosArr: [number, number, number] = [0, 0, 0]
  private readonly audioListenerDirArr: [number, number, number] = [0, 0, -1]
  private readonly audioListenerUpArr: [number, number, number] = [0, 1, 0]

  constructor(container: HTMLElement, opts: GameAppOptions = {}) {
    this.container = container
    this.multiplayerUrl = opts.multiplayerUrl ?? defaultMultiplayerUrl()

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x05070f)

    this.cockpit = new CockpitRig()
    this.camera = this.cockpit.camera
    this.scene.add(this.cockpit.root)

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    this.pipeline = new RenderPipeline({
      renderer: this.renderer,
      camera: this.camera,
      cockpitRoot: this.cockpit.root,
      container: this.container,
      onXrSessionStart: (session) => this.handleXrSessionStart(session as unknown as XRSession),
      onXrSessionEnd: () => this.handleXrSessionEnd(),
    })
    const canvas = this.renderer.domElement
    canvas.style.position = 'fixed'
    canvas.style.inset = '0'
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    this.container.append(canvas)

    if (this.useTouchInput) {
      this.inputManager.setAdapter(this.touchInput)
    } else {
      this.inputManager.setAdapter(this.desktopInput)
    }
    void this.syncInputForMode(this.pipeline.getMode())

    this.scene.add(new THREE.AmbientLight(0x334466, 1))
    this.scene.add(new THREE.DirectionalLight(0xffffff, 0.35))

    this.starfield = createStarfield(STAR_COUNT)
    this.scene.add(this.starfield)

    for (let i = 0; i < MAX_HUD_CONTACTS; i++) {
      this.contactPool.push({ position: { x: 0, y: 0, z: 0 } })
    }
    this.hudState = {
      shield: 1,
      energy: 1,
      score: 0,
      wave: 1,
      contacts: this.hudContacts,
    }
    this.hud = new DiegeticHUD(this.cockpit.hudMesh)
    this.pips = new OffscreenPips(this.cockpit.offscreenPips)

    this.asteroidPool = new AsteroidPool(this.scene)
    this.projectilePool = new ProjectilePool(this.scene)
    this.enemyPool = new EnemyPool(this.scene)
    this.shipPool = new ShipPool(this.scene)
    this.particleSystem = new ParticleSystem(this.scene)

    this.startScreen = new StartScreen({
      onTrain: (name) => {
        void this.beginSession('TRAINING', name)
      },
      onMultiplayer: (name) => {
        void this.beginSession('MULTIPLAYER', name)
      },
      onModeChange: (mode) => {
        this.refreshStartScreenLeaderboard(mode)
      },
    })
    this.respawnOverlay = new RespawnOverlay({
      onRespawn: () => this.requestRespawn(),
      onQuit: () => this.quitToMenu(),
    })
    this.leaderboardHud = new LeaderboardHud()

    this.startScreen.mount(this.container)
    this.respawnOverlay.mount(this.container)
    this.leaderboardHud.mount(this.container)
    this.respawnOverlay.hide()
    this.leaderboardHud.hide()

    this.startScreen.update({
      name: readPlayerName(),
      mode: 'TRAINING',
      entries: loadLocalLeaderboard().map((e) => ({ rank: e.rank, name: e.name, score: e.score })),
    })
    this.startScreen.show()

    window.addEventListener('resize', this.handleResize)
    this.resize()
  }

  start(): void {
    if (this.disposed || this.running) return
    this.running = true
    this.clock.start()
    this.renderer.setAnimationLoop(this.tick)
  }

  async setRenderMode(mode: RenderMode): Promise<void> {
    await this.pipeline.setMode(mode)
    await this.syncInputForMode(this.pipeline.getMode())
  }

  getRenderMode(): RenderMode {
    return this.pipeline.getMode()
  }

  adjustIpd(deltaMm: number): void {
    this.pipeline.adjustIpd(deltaMm)
  }

  recenter(): void {
    this.pipeline.recenter()
  }

  async resumeAudioFromGesture(): Promise<void> {
    await this.soundSynth.resumeFromGesture()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.running = false
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.handleResize)
    this.teardownTransport()
    this.inputManager.dispose()
    if (this.desktopInputAttached) {
      this.desktopInput.detach()
      this.desktopInputAttached = false
    }
    if (this.touchInputAttached) {
      this.touchInput.detach()
      this.touchInputAttached = false
    }
    if (this.vrBoxInputAttached) {
      void this.vrBoxInput.detach()
      this.vrBoxInputAttached = false
    }
    if (this.questXrSessionAttached) {
      this.questXrInput.detach()
      this.questXrSessionAttached = false
    }
    this.questXrInput.dispose()
    this.touchInput.dispose()
    this.startScreen.unmount()
    this.respawnOverlay.unmount()
    this.leaderboardHud.unmount()
    this.pipeline.dispose()
    this.hud.dispose()
    this.pips.dispose()
    this.asteroidPool.dispose()
    this.projectilePool.dispose()
    this.enemyPool.dispose()
    this.shipPool.dispose()
    this.particleSystem.dispose()
    this.soundSynth.dispose()
    this.scene.remove(this.cockpit.root)
    this.cockpit.dispose()
    this.scene.remove(this.starfield)
    this.starfield.geometry.dispose()
    this.starfield.material.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private readonly handleResize = (): void => {
    this.resize()
  }

  private readonly tick = (): void => {
    if (this.disposed) return
    const dt = this.clock.getDelta()
    this.starfield.rotation.y += dt * STARFIELD_SPIN_RAD_PER_SEC
    this.inputManager.update(dt)
    if (this.mode === 'MULTIPLAYER') this.predictor.decayCorrection(dt)
    this.updateNetworkTimers(dt)
    this.sendInputBatch()
    this.applySnapshotIfAny()
    this.updateMultiplayerRenderFrame()
    if (this.deathActive) this.updateDeath(dt)
    const starCenter = this.deathActive ? this.camera.position : this.cockpit.root.position
    recenterStarfield(this.starfield, starCenter)
    if (this.deathActive) {
      this.updateDeathCamera(dt)
    } else {
      this.applyFreeLook()
      this.cockpit.update(dt)
      this.updateCameraShake(dt)
    }
    this.hud.update(this.hudState, dt)
    this.pips.update(this.hudContacts, this.camera, dt)
    this.particleSystem.update(dt)
    this.updateAudioListener()
    this.pipeline.render(this.scene, this.camera)
  }

  private async beginSession(mode: GameMode, rawName: string): Promise<void> {
    if (this.disposed) return
    const name = rawName.trim().slice(0, 32) || 'Pilot'
    writePlayerName(name)

    this.teardownTransport()
    this.resetSessionState()
    this.mode = mode
    this.sessionActive = true
    this.pendingQuitToMenu = false
    this.localPlayerToken = readPlayerToken()

    this.startScreen.hide()
    this.leaderboardHud.show()
    this.respawnOverlay.hide()

    if (mode === 'TRAINING') {
      this.refreshLocalLeaderboardHud()
    } else {
      this.leaderboardHud.update({ title: 'Top 10 - Multiplayer', entries: [], current: null })
    }

    const transport = this.createTransport(mode)
    this.transport.current = transport
    this.unsubscribeTransport = transport.onMessage((msg) => this.handleServerMessage(msg))

    try {
      await transport.connect()
      if (this.disposed || this.transport.current !== transport) return
      const join: ClientMessage = {
        t: 'JOIN',
        roomId: mode === 'TRAINING' ? 'training' : 'default',
        name,
        platform: platformModeForRuntime(),
        ...(this.localPlayerToken ? { playerToken: this.localPlayerToken } : {}),
      }
      transport.send(join)
      this.transportReady = true
      this.pingTimerSec = 0
    } catch (err) {
      console.warn('[game] transport connect failed', err)
      if (this.transport.current === transport) {
        this.returnToStartScreen()
      }
    }
  }

  private createTransport(mode: GameMode): ITransport {
    if (mode === 'TRAINING') return new LocalTransport()
    return new WsTransport(this.multiplayerUrl, {
      onClose: () => {
        if (this.disposed) return
        if (this.mode === 'MULTIPLAYER' && this.sessionActive) {
          this.returnToStartScreen()
        }
      },
      onError: (err) => {
        console.warn('[game] multiplayer transport error', err)
      },
    })
  }

  private resetSessionState(): void {
    this.transportReady = false
    this.localPlayerId = null
    this.commandTick = 1
    this.commandBuffer.length = 0
    this.commandBatchOut.length = 0
    this.latestSnapshot = null
    this.appliedSnapshot = null
    this.deathActive = false
    this.deathElapsedSec = 0
    this.deathDelaySec = WORLD_CONFIG.RESPAWN_DELAY_SEC
    this.killerTarget = null
    this.currentRunScore = 0
    this.currentRunWave = 1
    this.currentLeaderboardRank = null
    this.bestRecordedRank = null
    this.bestRecordedScore = null
    this.lastRecordedScoreForRun = null
    this.lastRecordedScoreKey = null
    this.pendingQuitToMenu = false
    this.pingTimerSec = 0
    this.lastLocalShield = 100
    this.shakeTimeRemaining = 0
    this.shakeDuration = 0
    this.shakeIntensity = 0
    this.clockSync.reset()
    this.predictor.reset()
    this.interpolator.reset()
    this.predictedLocalShip = null
    this.hudContacts.length = 0
    this.hudState.shield = 1
    this.hudState.energy = 1
    this.hudState.score = 0
    this.hudState.wave = 1
    this.restoreCockpitCamera()
  }

  private teardownTransport(): void {
    this.transportReady = false
    this.unsubscribeTransport?.()
    this.unsubscribeTransport = null
    const transport = this.transport.current
    this.transport.current = null
    try {
      transport?.close()
    } catch {
      // ignore
    }
  }

  private returnToStartScreen(): void {
    this.teardownTransport()
    this.resetSessionState()
    this.sessionActive = false
    const currentMode = this.mode ?? 'TRAINING'
    this.mode = null
    this.respawnOverlay.hide()
    this.leaderboardHud.hide()
    this.refreshStartScreenLeaderboard(currentMode)
    this.startScreen.update({ name: readPlayerName(), mode: currentMode })
    this.startScreen.show()
  }

  private refreshStartScreenLeaderboard(mode: StartScreenMode): void {
    if (mode === 'TRAINING') {
      const entries = loadLocalLeaderboard().map((e) => ({ rank: e.rank, name: e.name, score: e.score }))
      this.startScreen.update({ mode, entries })
      return
    }
    this.startScreen.update({ mode, entries: [] })
  }

  private refreshLocalLeaderboardHud(): void {
    const entries = loadLocalLeaderboard()
    this.applyLocalBest(entries, readPlayerName())
    this.leaderboardHud.update({
      title: 'Top 10 - Treinamento',
      entries: entries.map((e) => ({ rank: e.rank, name: e.name, score: e.score })),
      current: {
        rank: this.currentLeaderboardRank,
        name: readPlayerName() || 'Pilot',
        score: this.currentRunScore,
        bestRank: this.bestRecordedRank,
        bestScore: this.bestRecordedScore,
      },
    })
  }

  private applyLocalBest(entries: RankedLocalLeaderboardEntry[], playerName?: string): void {
    const name = (playerName ?? readPlayerName()).trim().toLowerCase()
    let best: RankedLocalLeaderboardEntry | undefined
    if (name.length > 0) {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]
        if (e !== undefined && e.name.trim().toLowerCase() === name) {
          best = e
          break // entries are sorted desc by score
        }
      }
    }
    if (best !== undefined) {
      this.bestRecordedRank = best.rank
      this.bestRecordedScore = best.score
    } else {
      this.bestRecordedRank = null
      this.bestRecordedScore = null
    }
  }

  private requestRespawn(): void {
    if (!this.deathActive || !this.transportReady) return
    if (!isRespawnReady(this.deathDelaySec, this.deathElapsedSec)) return
    this.transport.current?.send({ t: 'RESPAWN_REQUEST' })
  }

  private quitToMenu(): void {
    if (!this.sessionActive) {
      this.returnToStartScreen()
      return
    }

    if (this.mode === 'TRAINING' && shouldRecordScore(this.currentRunScore) && this.lastRecordedScoreForRun !== this.currentRunScore) {
      const name = readPlayerName() || 'Pilot'
      const scoreKey = `${this.localPlayerId ?? 'p1'}:${this.currentRunScore}:${this.currentRunWave}`
      if (this.lastRecordedScoreKey !== scoreKey) {
        recordLocalScore({
          name,
          score: this.currentRunScore,
          wave: this.currentRunWave,
          createdAt: new Date().toISOString(),
        })
        this.lastRecordedScoreKey = scoreKey
        this.lastRecordedScoreForRun = this.currentRunScore
      }
    }

    if (this.transportReady) {
      try {
        this.transport.current?.send({ t: 'QUIT' })
      } catch {
        // ignore
      }
    }

    this.pendingQuitToMenu = true
    this.returnToStartScreen()
  }

  private handleServerMessage(msg: ServerMessage): void {
    if (this.disposed) return
    if (msg.t === 'WELCOME') {
      this.localPlayerId = msg.playerId
      if (typeof msg.playerToken === 'string' && msg.playerToken.trim().length > 0) {
        this.localPlayerToken = msg.playerToken.trim()
        writePlayerToken(this.localPlayerToken)
      }
      return
    }
    if (msg.t === 'PONG') {
      this.clockSync.handlePong(msg.clientTime, msg.serverTime)
      return
    }
    if (msg.t === 'SNAPSHOT') {
      this.latestSnapshot = msg
      return
    }
    if (msg.t === 'LEADERBOARD') {
      const current = msg.current
      if (current) {
        if (typeof current.rank === 'number' && Number.isFinite(current.rank)) {
          this.currentLeaderboardRank = current.rank
          if (this.bestRecordedRank === null || current.rank < this.bestRecordedRank) {
            this.bestRecordedRank = current.rank
          }
        }
        if (typeof current.score === 'number' && Number.isFinite(current.score)) {
          if (this.bestRecordedScore === null || current.score > this.bestRecordedScore) {
            this.bestRecordedScore = current.score
          }
        }
      }
      this.leaderboardHud.update({
        title: this.mode === 'MULTIPLAYER' ? 'Top 10 - Multiplayer' : 'Top 10 - Treinamento',
        entries: msg.entries.map((e) => ({ rank: e.rank, name: e.name, score: e.score })),
        current: {
          rank: this.currentLeaderboardRank,
          name: readPlayerName() || 'Pilot',
          score: this.currentRunScore,
          bestRank: this.bestRecordedRank,
          bestScore: this.bestRecordedScore,
        },
      })
      return
    }
    if (msg.t === 'EVENT') {
      this.handleGameEvent(msg)
    }
  }

  private handleGameEvent(msg: ServerMessage & { t: 'EVENT' }): void {
    this.soundSynth.playEvent(msg)
    if (msg.kind === 'EXPLOSION' || msg.kind === 'HIT' || msg.kind === 'PLAYER_DEATH') {
      this.particleSystem.handleEvent(msg)
    }

    if (msg.kind === 'SCORE_RECORDED') {
      if (msg.playerId === this.localPlayerId) {
        const scoreKey = `${msg.playerId}:${msg.score}:${msg.wave}`
        if (this.lastRecordedScoreKey === scoreKey) return

        this.lastRecordedScoreKey = scoreKey
        this.lastRecordedScoreForRun = msg.score
        if (typeof msg.rank === 'number' && Number.isFinite(msg.rank)) {
          this.currentLeaderboardRank = msg.rank
          if (this.bestRecordedRank === null || msg.rank < this.bestRecordedRank) {
            this.bestRecordedRank = msg.rank
          }
        }
        if (msg.score > (this.bestRecordedScore ?? -1)) this.bestRecordedScore = msg.score

        if (this.mode === 'TRAINING') {
          const entries = recordLocalScore({
            name: msg.name,
            score: msg.score,
            wave: msg.wave,
            createdAt: new Date().toISOString(),
          })
          this.applyLocalBest(entries, msg.name)
          this.leaderboardHud.update({
            entries: entries.map((e) => ({ rank: e.rank, name: e.name, score: e.score })),
            current: {
              rank: this.currentLeaderboardRank,
              name: readPlayerName() || msg.name,
              score: this.currentRunScore,
              bestRank: this.bestRecordedRank,
              bestScore: this.bestRecordedScore,
            },
          })
        } else {
          this.leaderboardHud.update({
            current: {
              rank: this.currentLeaderboardRank,
              name: readPlayerName() || msg.name,
              score: this.currentRunScore,
              bestRank: this.bestRecordedRank,
              bestScore: this.bestRecordedScore,
            },
          })
        }
      }
      return
    }

    if (msg.kind === 'PLAYER_DEATH' && msg.playerId === this.localPlayerId) {
      this.onLocalPlayerDeath(msg)
    }
  }

  private onLocalPlayerDeath(msg: Extract<ServerMessage, { t: 'EVENT'; kind: 'PLAYER_DEATH' }>): void {
    this.deathActive = true
    this.deathElapsedSec = 0
    this.deathDelaySec =
      typeof msg.respawnDelaySec === 'number' && Number.isFinite(msg.respawnDelaySec) && msg.respawnDelaySec > 0
        ? msg.respawnDelaySec
        : WORLD_CONFIG.RESPAWN_DELAY_SEC
    this.killerTarget = selectKillerCameraTarget(msg, this.buildKillerEntities())
    this.spectatorOrbitAngle = 0
    this.spectatorLookAt.set(msg.killerPos?.[0] ?? msg.pos[0], msg.killerPos?.[1] ?? msg.pos[1], msg.killerPos?.[2] ?? msg.pos[2])
    this.enterDeathCamera()
    this.respawnOverlay.update({
      killerName: this.killerNameFromEvent(msg),
      countdownSec: this.deathDelaySec,
      canRespawn: false,
      visible: true,
    })
  }

  private killerNameFromEvent(msg: Extract<ServerMessage, { t: 'EVENT'; kind: 'PLAYER_DEATH' }>): string {
    if (msg.killerKind === 'ASTEROID') return 'asteroide'
    if (msg.killerKind === 'UNKNOWN') return ''
    if (msg.killerKind === 'PLAYER') return 'outro piloto'
    if (msg.killerKind === 'ENEMY') return 'inimigo'
    return ''
  }

  private buildKillerEntities(): KillerCameraEntityLike[] {
    const out = this.killerEntities
    out.length = 0
    const snap = this.latestSnapshot
    if (!snap) return out
    for (let i = 0; i < snap.enemies.length; i++) {
      const e = snap.enemies[i]
      if (e === undefined) continue
      out.push({ id: e.id, kind: 'ENEMY', pos: e.pos, alive: e.hp > 0 })
    }
    for (let i = 0; i < snap.ships.length; i++) {
      const s = snap.ships[i]
      if (s === undefined) continue
      if (s.id === this.localPlayerId) continue
      out.push({ id: s.id, kind: 'PLAYER', pos: s.pos, alive: s.alive })
    }
    for (let i = 0; i < snap.asteroids.length; i++) {
      const a = snap.asteroids[i]
      if (a === undefined) continue
      out.push({ id: a.id, kind: 'ASTEROID', pos: a.pos, alive: a.hp > 0 })
    }
    return out
  }

  private updateDeath(dt: number): void {
    this.deathElapsedSec += dt
    const remaining = respawnCountdownSec(this.deathDelaySec, this.deathElapsedSec)
    const ready = isRespawnReady(this.deathDelaySec, this.deathElapsedSec)
    this.respawnOverlay.update({ countdownSec: remaining, canRespawn: ready })
  }

  private updateNetworkTimers(dt: number): void {
    if (!this.transportReady || this.mode !== 'MULTIPLAYER') return
    this.pingTimerSec += dt
    if (this.pingTimerSec < PING_INTERVAL_SEC) return
    this.pingTimerSec = 0
    this.transport.current?.send({ t: 'PING', clientTime: performance.now() })
  }

  private sendInputBatch(): void {
    if (!this.sessionActive) return
    const cmd = this.inputManager.getCommand(this.commandTick)
    this.commandTick += 1

    if (this.mode === 'MULTIPLAYER' && this.predictedLocalShip && this.predictedLocalShip.alive) {
      this.predictor.predict(this.predictedLocalShip, cmd)
    }

    this.commandBuffer.push(cmd)
    if (this.commandBuffer.length > COMMAND_BUFFER_SIZE) {
      this.commandBuffer.shift()
    }

    if (!this.transportReady || this.disposed) return
    this.commandBatchOut.length = this.commandBuffer.length
    for (let i = 0; i < this.commandBuffer.length; i++) {
      this.commandBatchOut[i] = this.commandBuffer[i]!
    }
    this.transport.current?.send({ t: 'INPUT_BATCH', cmds: this.commandBatchOut })
  }

  private applySnapshotIfAny(): void {
    const snap = this.latestSnapshot
    if (snap === null || snap === this.appliedSnapshot) return
    this.appliedSnapshot = snap

    this.asteroidPool.update(snap.asteroids)
    this.projectilePool.update(snap.projectiles)
    this.enemyPool.update(snap.enemies)
    this.updateRemoteInterpolation(snap)
    const shipsForRender = this.getShipsForRender(snap)
    this.shipPool.update(shipsForRender, this.localPlayerId)
    this.updateHudFromSnapshot(snap)
  }

  private updateRemoteInterpolation(snap: ServerMessage & { t: 'SNAPSHOT' }): void {
    if (this.mode !== 'MULTIPLAYER') return
    const entities: { id: string | number; pos: [number, number, number]; rot: [number, number, number, number] }[] = []
    for (let i = 0; i < snap.ships.length; i++) {
      const s = snap.ships[i]
      if (s === undefined) continue
      if (this.localPlayerId !== null && s.id === this.localPlayerId) continue
      entities.push({ id: s.id, pos: s.pos, rot: s.rot })
    }
    this.interpolator.push(snap.serverTime, entities)
  }

  private getShipsForRender(snap: ServerMessage & { t: 'SNAPSHOT' }): readonly ShipState[] {
    if (this.mode !== 'MULTIPLAYER') return snap.ships
    const renderTime = this.clockSync.serverNow()
    let changed = false
    let out: ShipState[] | null = null
    for (let i = 0; i < snap.ships.length; i++) {
      const s = snap.ships[i]
      if (s === undefined) continue
      if (this.localPlayerId !== null && s.id === this.localPlayerId) continue
      if (this.interpolator.sampleInto(s.id, renderTime, this.interpShipState)) {
        if (!changed) {
          out = snap.ships.slice()
          changed = true
        }
        const copy = this.cloneShipState(s)
        copy.pos[0] = this.interpShipState.pos[0]
        copy.pos[1] = this.interpShipState.pos[1]
        copy.pos[2] = this.interpShipState.pos[2]
        copy.rot[0] = this.interpShipState.rot[0]
        copy.rot[1] = this.interpShipState.rot[1]
        copy.rot[2] = this.interpShipState.rot[2]
        copy.rot[3] = this.interpShipState.rot[3]
        out![i] = copy
      }
    }
    return changed && out !== null ? out : snap.ships
  }

  private updateHudFromSnapshot(snap: ServerMessage & { t: 'SNAPSHOT' }): void {
    let local = snap.ships[0]
    if (this.localPlayerId !== null) {
      for (let i = 0; i < snap.ships.length; i++) {
        const s = snap.ships[i]
        if (s !== undefined && s.id === this.localPlayerId) {
          local = s
          break
        }
      }
    }

    if (local !== undefined) {
      this.currentRunScore = local.score
      this.currentRunWave = snap.wave

      if (this.mode === 'MULTIPLAYER') {
        if (!this.predictedLocalShip) {
          this.predictedLocalShip = this.cloneShipState(local)
        } else {
          this.predictor.reconcile(this.predictedLocalShip, local)
        }
      } else {
        this.predictedLocalShip = null
      }

      if (local.alive) {
        if (this.deathActive) this.onLocalRespawned()
        const display = this.getLocalDisplayShip(local)
        this.cockpit.root.position.set(display.pos[0], display.pos[1], display.pos[2])
        this.cockpit.root.quaternion.set(display.rot[0], display.rot[1], display.rot[2], display.rot[3])

        const nextShield = Math.max(0, local.shield)
        if (nextShield < this.lastLocalShield - 0.01) {
          const damage = this.lastLocalShield - nextShield
          const intensity = Math.min(0.35, 0.04 + damage / 140)
          this.triggerCameraShake(intensity, 0.22)
          this.soundSynth.playEvent({
            kind: 'HIT',
            pos: this.audioListenerPosArr,
            scale: Math.max(0.8, Math.min(2.5, damage / 20)),
          })
        }
        this.lastLocalShield = nextShield
      } else {
        this.lastLocalShield = Math.max(0, local.shield)
      }

      this.hudState.shield = Math.max(0, local.shield / 100)
      this.hudState.energy = Math.max(0, local.energy / 100)
      this.hudState.score = local.score
    }
    this.hudState.wave = snap.wave

    this.updateContacts(snap)
    this.refreshLeaderboardHudCurrent()
  }

  private cloneShipState(src: ShipState): ShipState {
    return {
      id: src.id,
      name: src.name,
      platform: src.platform,
      pos: [src.pos[0], src.pos[1], src.pos[2]],
      vel: [src.vel[0], src.vel[1], src.vel[2]],
      rot: [src.rot[0], src.rot[1], src.rot[2], src.rot[3]],
      angVel: [src.angVel[0], src.angVel[1], src.angVel[2]],
      shield: src.shield,
      energy: src.energy,
      score: src.score,
      alive: src.alive,
      invulnTimer: src.invulnTimer,
      lastProcessedTick: src.lastProcessedTick,
    }
  }

  private getLocalDisplayShip(authoritative: ShipState): ShipState {
    if (this.mode !== 'MULTIPLAYER' || !this.predictedLocalShip) return authoritative
    this.predictor.getDisplayState(this.predictedLocalShip, this.displayLocalShip)
    // Keep authoritative non-physics HUD/identity fields.
    this.displayLocalShip.shield = authoritative.shield
    this.displayLocalShip.energy = authoritative.energy
    this.displayLocalShip.score = authoritative.score
    this.displayLocalShip.alive = authoritative.alive
    this.displayLocalShip.invulnTimer = authoritative.invulnTimer
    return this.displayLocalShip
  }

  private updateMultiplayerRenderFrame(): void {
    if (this.mode !== 'MULTIPLAYER') return
    const snap = this.latestSnapshot
    if (snap === null) return

    const renderTime = this.clockSync.serverNow()
    this.shipPool.updateWithInterpolation(
      snap.ships,
      this.localPlayerId,
      renderTime,
      (id, serverTime, out) => this.interpolator.sampleInto(id, serverTime, out),
      this.interpShipState,
    )

    if (this.deathActive) return
    const predicted = this.predictedLocalShip
    if (!predicted || !predicted.alive) return
    this.predictor.getDisplayState(predicted, this.displayLocalShip)
    this.cockpit.root.position.set(
      this.displayLocalShip.pos[0],
      this.displayLocalShip.pos[1],
      this.displayLocalShip.pos[2],
    )
    this.cockpit.root.quaternion.set(
      this.displayLocalShip.rot[0],
      this.displayLocalShip.rot[1],
      this.displayLocalShip.rot[2],
      this.displayLocalShip.rot[3],
    )
  }

  private refreshLeaderboardHudCurrent(): void {
    this.leaderboardHud.update({
      current: {
        rank: this.currentLeaderboardRank,
        name: readPlayerName() || 'Pilot',
        score: this.currentRunScore,
        bestRank: this.bestRecordedRank,
        bestScore: this.bestRecordedScore,
      },
    })
  }

  private onLocalRespawned(): void {
    this.deathActive = false
    this.deathElapsedSec = 0
    this.killerTarget = null
    this.lastRecordedScoreForRun = null
    this.lastRecordedScoreKey = null
    this.respawnOverlay.hide()
    this.restoreCockpitCamera()
  }

  private updateContacts(snap: ServerMessage & { t: 'SNAPSHOT' }): void {
    let count = 0
    const max = MAX_HUD_CONTACTS

    for (let i = 0; i < snap.asteroids.length && count < max; i++) {
      const a = snap.asteroids[i]
      if (a === undefined) continue
      const c = this.contactPool[count]
      if (c === undefined) break
      c.position.x = a.pos[0]
      c.position.y = a.pos[1]
      c.position.z = a.pos[2]
      this.hudContacts[count] = c
      count++
    }

    for (let i = 0; i < snap.enemies.length && count < max; i++) {
      const e = snap.enemies[i]
      if (e === undefined) continue
      const c = this.contactPool[count]
      if (c === undefined) break
      c.position.x = e.pos[0]
      c.position.y = e.pos[1]
      c.position.z = e.pos[2]
      this.hudContacts[count] = c
      count++
    }

    for (let i = 0; i < snap.ships.length && count < max; i++) {
      const s = snap.ships[i]
      if (s === undefined) continue
      if (this.localPlayerId !== null && s.id === this.localPlayerId) continue
      const c = this.contactPool[count]
      if (c === undefined) break
      c.position.x = s.pos[0]
      c.position.y = s.pos[1]
      c.position.z = s.pos[2]
      this.hudContacts[count] = c
      count++
    }

    this.hudContacts.length = count
  }

  private enterDeathCamera(): void {
    if (this.disposed) return
    if (this.camera.parent !== this.scene) {
      this.scene.attach(this.camera)
    }
    this.cockpit.root.visible = false
    this.camera.position.set(
      this.spectatorLookAt.x,
      this.spectatorLookAt.y + 10,
      this.spectatorLookAt.z + 24,
    )
    this.camera.lookAt(this.spectatorLookAt)
  }

  private restoreCockpitCamera(): void {
    if (this.disposed) return
    this.cockpit.root.visible = true
    if (this.camera.parent !== this.cockpit.pilotHeadRig) {
      this.cockpit.pilotHeadRig.attach(this.camera)
    }
    this.camera.position.set(0, 0, 0)
    this.camera.quaternion.identity()
    this.camera.rotation.set(0, 0, 0)
  }

  private updateDeathCamera(dt: number): void {
    const target = this.resolveKillerTargetPos()
    const lerpLook = 1 - Math.exp(-dt * 2.5)
    this.spectatorLookAt.lerp(target, lerpLook)

    if (this.killerTarget?.kind === 'point') {
      this.spectatorOrbitAngle += dt * 0.35
      const radius = 24
      this.spectatorDesiredPos.set(
        this.spectatorLookAt.x + Math.cos(this.spectatorOrbitAngle) * radius,
        this.spectatorLookAt.y + 10,
        this.spectatorLookAt.z + Math.sin(this.spectatorOrbitAngle) * radius,
      )
      this.camera.position.lerp(this.spectatorDesiredPos, 1 - Math.exp(-dt * 1.2))
    } else {
      this.spectatorDesiredPos.set(
        this.spectatorLookAt.x,
        this.spectatorLookAt.y + 10,
        this.spectatorLookAt.z + 24,
      )
      this.camera.position.lerp(this.spectatorDesiredPos, 1 - Math.exp(-dt * 1.8))
    }
    this.camera.lookAt(this.spectatorLookAt)
  }

  private resolveKillerTargetPos(): THREE.Vector3 {
    const snap = this.latestSnapshot
    const target = this.killerTarget
    if (target?.kind === 'entity' && snap !== null) {
      if (target.entityKind === 'ENEMY') {
        for (let i = 0; i < snap.enemies.length; i++) {
          const e = snap.enemies[i]
          if (e !== undefined && e.id === target.id && e.hp > 0) {
            this.spectatorTargetPos.set(e.pos[0], e.pos[1], e.pos[2])
            return this.spectatorTargetPos
          }
        }
      } else if (target.entityKind === 'PLAYER') {
        for (let i = 0; i < snap.ships.length; i++) {
          const s = snap.ships[i]
          if (s !== undefined && s.id === target.id && s.alive) {
            this.spectatorTargetPos.set(s.pos[0], s.pos[1], s.pos[2])
            return this.spectatorTargetPos
          }
        }
      } else if (target.entityKind === 'ASTEROID') {
        for (let i = 0; i < snap.asteroids.length; i++) {
          const a = snap.asteroids[i]
          if (a !== undefined && a.id === target.id && a.hp > 0) {
            this.spectatorTargetPos.set(a.pos[0], a.pos[1], a.pos[2])
            return this.spectatorTargetPos
          }
        }
      }
      // entity died/disappeared: fall back to last known lookAt (impact-like point)
      this.killerTarget = { kind: 'point', pos: [this.spectatorLookAt.x, this.spectatorLookAt.y, this.spectatorLookAt.z] }
    }

    if (this.killerTarget?.kind === 'point') {
      this.spectatorTargetPos.set(this.killerTarget.pos[0], this.killerTarget.pos[1], this.killerTarget.pos[2])
      return this.spectatorTargetPos
    }

    this.spectatorTargetPos.copy(this.spectatorLookAt)
    return this.spectatorTargetPos
  }

  private async syncInputForMode(mode: RenderMode): Promise<void> {
    const token = ++this.inputSyncToken
    const isCurrent = (): boolean =>
      token === this.inputSyncToken && !this.disposed && this.pipeline.getMode() === mode

    const shouldAttachFlat = mode === 'FLAT' && !this.disposed
    const shouldAttachVRBox = mode === 'VR_BOX' && !this.disposed
    const shouldAttachQuestXr = mode === 'QUEST_3' && !this.disposed

    if (this.useTouchInput) {
      if (shouldAttachFlat && !this.touchInputAttached) {
        this.touchInput.attach(this.renderer.domElement)
        this.touchInputAttached = true
      } else if (!shouldAttachFlat && this.touchInputAttached) {
        this.touchInput.detach()
        this.touchInputAttached = false
      }
      if (this.desktopInputAttached) {
        this.desktopInput.detach()
        this.desktopInputAttached = false
      }
    } else {
      if (shouldAttachFlat && !this.desktopInputAttached) {
        this.desktopInput.attach(this.renderer.domElement)
        this.desktopInputAttached = true
      } else if (!shouldAttachFlat && this.desktopInputAttached) {
        this.desktopInput.detach()
        this.desktopInputAttached = false
      }
    }

    if (!isCurrent()) return

    if (!shouldAttachQuestXr && this.questXrSessionAttached) {
      this.questXrInput.detach()
      this.questXrSessionAttached = false
    }

    if (!shouldAttachVRBox && this.vrBoxInputAttached) {
      try {
        await this.vrBoxInput.detach()
      } catch {
        // ignore
      }
      if (!isCurrent()) return
      this.vrBoxInputAttached = false
      this.resetHeadLook()
    }

    if (!isCurrent()) return

    if (shouldAttachVRBox && !this.vrBoxInputAttached) {
      this.inputManager.setAdapter(this.vrBoxInput)
      try {
        await this.vrBoxInput.attach()
      } catch {
        // Degraded mode: status exposed by VRBoxInput; continue.
      }
      if (!isCurrent()) {
        try {
          await this.vrBoxInput.detach()
        } catch {
          // ignore
        }
        return
      }
      this.vrBoxInputAttached = true
      this.resetHeadLook()
      return
    }

    if (shouldAttachQuestXr) {
      this.inputManager.setAdapter(this.questXrInput)
      const session = this.pipeline.getActiveXrSession()
      if (session && !this.questXrSessionAttached) {
        this.questXrInput.attach(session as unknown as XRSession)
        this.questXrSessionAttached = true
      } else if (!session && this.questXrSessionAttached) {
        this.questXrInput.detach()
        this.questXrSessionAttached = false
      }
      this.resetHeadLook()
      return
    }

    if (!shouldAttachFlat && !shouldAttachVRBox) {
      this.resetHeadLook()
    }

    if (shouldAttachFlat) {
      if (this.useTouchInput) this.inputManager.setAdapter(this.touchInput)
      else this.inputManager.setAdapter(this.desktopInput)
    }
  }

  private handleXrSessionStart(session: XRSession): void {
    if (this.disposed) return
    if (this.pipeline.getMode() !== 'QUEST_3') return
    this.inputManager.setAdapter(this.questXrInput)
    this.questXrInput.attach(session)
    this.questXrSessionAttached = true
    this.resetHeadLook()
  }

  private handleXrSessionEnd(): void {
    if (this.questXrSessionAttached) {
      this.questXrInput.detach()
      this.questXrSessionAttached = false
    }
    if (this.disposed) return
    if (this.pipeline.getMode() === 'QUEST_3') {
      this.inputManager.setAdapter(this.questXrInput)
      this.resetHeadLook()
    }
  }

  private applyFreeLook(): void {
    const mode = this.pipeline.getMode()
    if (mode === 'VR_BOX') {
      const q = this.vrBoxInput.getHeadQuat(this.vrBoxHeadQuat)
      this.cockpit.pilotHeadRig.quaternion.set(q.x, q.y, q.z, q.w)
      return
    }
    if (mode !== 'FLAT') {
      this.resetHeadLook()
      return
    }
    const look = this.desktopInput.getFreeLookState()
    if (!look.active) {
      this.resetHeadLook()
      return
    }
    this.cockpit.pilotHeadRig.rotation.y = -look.yaw * FREE_LOOK_MAX_YAW
    this.cockpit.pilotHeadRig.rotation.x = -look.pitch * FREE_LOOK_MAX_PITCH
  }

  private resetHeadLook(): void {
    this.cockpit.pilotHeadRig.rotation.x = 0
    this.cockpit.pilotHeadRig.rotation.y = 0
  }

  private updateAudioListener(): void {
    this.camera.getWorldPosition(this.audioListenerPos)
    this.camera.getWorldDirection(this.audioListenerDir)
    this.camera.getWorldQuaternion(this.audioListenerQuat)
    this.audioListenerUp.set(0, 1, 0).applyQuaternion(this.audioListenerQuat)

    this.audioListenerPosArr[0] = this.audioListenerPos.x
    this.audioListenerPosArr[1] = this.audioListenerPos.y
    this.audioListenerPosArr[2] = this.audioListenerPos.z
    this.audioListenerDirArr[0] = this.audioListenerDir.x
    this.audioListenerDirArr[1] = this.audioListenerDir.y
    this.audioListenerDirArr[2] = this.audioListenerDir.z
    this.audioListenerUpArr[0] = this.audioListenerUp.x
    this.audioListenerUpArr[1] = this.audioListenerUp.y
    this.audioListenerUpArr[2] = this.audioListenerUp.z

    this.soundSynth.updateListener(
      this.audioListenerPosArr,
      this.audioListenerDirArr,
      this.audioListenerUpArr,
    )
  }

  private triggerCameraShake(intensity: number, duration: number): void {
    if (this.deathActive) {
      this.shakeIntensity = Math.max(this.shakeIntensity, Math.min(0.5, intensity))
      this.shakeDuration = Math.max(this.shakeDuration, duration)
      this.shakeTimeRemaining = Math.max(this.shakeTimeRemaining, duration)
      return
    }
    if (intensity <= this.shakeIntensity && this.shakeTimeRemaining > 0) return
    this.shakeIntensity = Math.max(0, intensity)
    this.shakeDuration = Math.max(0.01, duration)
    this.shakeTimeRemaining = this.shakeDuration
  }

  private updateCameraShake(dt: number): void {
    if (this.shakeTimeRemaining <= 0) {
      this.camera.position.set(0, 0, 0)
      return
    }
    this.shakeTimeRemaining = Math.max(0, this.shakeTimeRemaining - dt)
    const t = this.shakeDuration > 0 ? this.shakeTimeRemaining / this.shakeDuration : 0
    const amp = this.shakeIntensity * t
    const n = performance.now() * 0.001
    this.camera.position.set(
      Math.sin(n * 43.7) * amp,
      Math.cos(n * 37.3) * amp * 0.6,
      0,
    )
  }

  private resize(): void {
    this.pipeline.resize(window.innerWidth, window.innerHeight)
  }
}
