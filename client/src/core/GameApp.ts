import * as THREE from 'three'
import type { ClientMessage, ServerMessage, ShipCommand } from '@asteroids/shared'
import { CockpitRig } from './CockpitRig'
import { RenderPipeline, type RenderMode } from './RenderPipeline'
import { createStarfield } from './Starfield'
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
import { LocalTransport } from '../net/LocalTransport'
import type { ITransport } from '../net/ITransport'
import { DiegeticHUD } from '../ui/DiegeticHUD'
import { OffscreenPips } from '../ui/OffscreenPips'
import type { Contact, HudState } from '../ui/hud-math'

const STAR_COUNT = 2000
const STARFIELD_SPIN_RAD_PER_SEC = 0.006
const FREE_LOOK_MAX_YAW = 1.2
const FREE_LOOK_MAX_PITCH = 0.8
const MAX_HUD_CONTACTS = 16
const COMMAND_BUFFER_SIZE = 6

function isMobileTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const touchPoints = navigator.maxTouchPoints ?? 0
  if (touchPoints <= 0) return false
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(pointer: coarse)').matches
  }
  return true
}

/** Bootstrap da cena Three.js: cena, câmera, renderer, loop e ciclo de vida. */
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

  private readonly transport: ITransport
  private unsubscribeTransport: (() => void) | null = null
  private localPlayerId: string | null = null
  private commandTick = 1
  private readonly commandBuffer: ShipCommand[] = []
  private readonly commandBatchOut: ShipCommand[] = []
  private transportReady = false
  private latestSnapshot: (ServerMessage & { t: 'SNAPSHOT' }) | null = null
  private appliedSnapshot: (ServerMessage & { t: 'SNAPSHOT' }) | null = null

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

  constructor(container: HTMLElement) {
    this.container = container

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x05070f)

    // A câmera é fornecida pelo rig: PilotHeadRig controla apenas a cabeça (ADR-01).
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

    // Iluminação mínima; brilho neste projeto vem de emissivos/Fresnel, não de bloom (ADR-04).
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

    this.transport = new LocalTransport()
    this.unsubscribeTransport = this.transport.onMessage((msg) => this.handleServerMessage(msg))
    void this.connectTransport()

    window.addEventListener('resize', this.handleResize)
    this.resize()
  }

  start(): void {
    if (this.disposed || this.running) return
    this.running = true
    this.clock.start()
    // setAnimationLoop usa rAF no desktop e o requestAnimationFrame da sessão em WebXR.
    this.renderer.setAnimationLoop(this.tick)
  }

  /** Seleção de modo (FLAT / VR_BOX / QUEST_3) — ver main.ts para a fonte da config. */
  async setRenderMode(mode: RenderMode): Promise<void> {
    await this.pipeline.setMode(mode)
    await this.syncInputForMode(this.pipeline.getMode())
  }

  getRenderMode(): RenderMode {
    return this.pipeline.getMode()
  }

  /** Ajuste dev de IPD via teclas; D-Pad/gamepad Quest fica para M3. */
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
    this.transportReady = false
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.handleResize)
    this.unsubscribeTransport?.()
    this.unsubscribeTransport = null
    this.transport.close()
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

  /** Chamado via requestAnimationFrame: sem `new`, arrays temporários ou closures por frame. */
  private readonly tick = (): void => {
    if (this.disposed) return
    const dt = this.clock.getDelta()
    this.starfield.rotation.y += dt * STARFIELD_SPIN_RAD_PER_SEC
    this.inputManager.update(dt)
    this.sendInputBatch()
    this.applySnapshotIfAny()
    this.applyFreeLook()
    this.cockpit.update(dt)
    this.hud.update(this.hudState, dt)
    this.pips.update(this.hudContacts, this.camera, dt)
    this.particleSystem.update(dt)
    this.updateAudioListener()
    this.pipeline.render(this.scene, this.camera)
  }

  getInputManager(): InputManager {
    return this.inputManager
  }

  getVRBoxInput(): VRBoxInput {
    return this.vrBoxInput
  }

  private async connectTransport(): Promise<void> {
    try {
      await this.transport.connect()
      if (this.disposed) return
      const join: ClientMessage = { t: 'JOIN', roomId: 'solo', name: 'Player', platform: 'PC' }
      this.transport.send(join)
      this.transportReady = true
    } catch (err) {
      console.warn('[game] transport connect failed', err)
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    if (this.disposed) return
    if (msg.t === 'WELCOME') {
      this.localPlayerId = msg.playerId
      return
    }
    if (msg.t === 'SNAPSHOT') {
      this.latestSnapshot = msg
      return
    }
    if (msg.t === 'EVENT') {
      this.soundSynth.playEvent(msg)
      if (msg.kind === 'EXPLOSION' || msg.kind === 'HIT' || msg.kind === 'PLAYER_DEATH') {
        this.particleSystem.handleEvent(msg)
      }
    }
  }

  private sendInputBatch(): void {
    // Send commands with redundancy; GameRoom ignores old ticks.
    const cmd = this.inputManager.getCommand(this.commandTick)
    this.commandTick += 1

    this.commandBuffer.push(cmd)
    if (this.commandBuffer.length > COMMAND_BUFFER_SIZE) {
      this.commandBuffer.shift()
    }

    if (!this.transportReady || this.disposed) return
    this.commandBatchOut.length = this.commandBuffer.length
    for (let i = 0; i < this.commandBuffer.length; i++) {
      this.commandBatchOut[i] = this.commandBuffer[i]!
    }
    const batch: ClientMessage = { t: 'INPUT_BATCH', cmds: this.commandBatchOut }
    this.transport.send(batch)
  }

  private applySnapshotIfAny(): void {
    const snap = this.latestSnapshot
    if (snap === null || snap === this.appliedSnapshot) return
    this.appliedSnapshot = snap

    this.asteroidPool.update(snap.asteroids)
    this.projectilePool.update(snap.projectiles)
    this.enemyPool.update(snap.enemies)
    this.shipPool.update(snap.ships, this.localPlayerId)
    this.updateHudFromSnapshot(snap)
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
      this.hudState.shield = Math.max(0, local.shield / 100)
      this.hudState.energy = Math.max(0, local.energy / 100)
      this.hudState.score = local.score
    }
    this.hudState.wave = snap.wave

    this.updateContacts(snap)
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

    // Also include other ships as contacts (rare in solo, cheap to support).
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

  private async syncInputForMode(mode: RenderMode): Promise<void> {
    const token = ++this.inputSyncToken
    const isCurrent = (): boolean =>
      token === this.inputSyncToken && !this.disposed && this.pipeline.getMode() === mode

    const shouldAttachFlat = mode === 'FLAT' && !this.disposed
    const shouldAttachVRBox = mode === 'VR_BOX' && !this.disposed
    const shouldAttachQuestXr = mode === 'QUEST_3' && !this.disposed

    // Sync flat inputs (synchronous attach/detach).
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

    // Detach adapters that do not belong to the target mode before any early return.
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

    // Attach VR Box input when entering VR_BOX.
    if (shouldAttachVRBox && !this.vrBoxInputAttached) {
      this.inputManager.setAdapter(this.vrBoxInput)
      try {
        await this.vrBoxInput.attach()
      } catch {
        // Degraded mode: status exposed by VRBoxInput; continue.
      }
      if (!isCurrent()) {
        // A newer sync won; ensure we don't leave VRBox attached behind.
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

  private resize(): void {
    this.pipeline.resize(window.innerWidth, window.innerHeight)
  }
}
