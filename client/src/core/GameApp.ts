import * as THREE from 'three'
import { CockpitRig } from './CockpitRig'
import { RenderPipeline, type RenderMode } from './RenderPipeline'
import { createStarfield } from './Starfield'
import { DesktopInput } from '../input/DesktopInput'
import { InputManager } from '../input/InputManager'
import { QuestXRInput } from '../input/QuestXRInput'
import { TouchInput } from '../input/TouchInput'
import { VRBoxInput } from '../input/VRBoxInput'
import { DiegeticHUD } from '../ui/DiegeticHUD'
import { OffscreenPips } from '../ui/OffscreenPips'
import type { Contact, HudState } from '../ui/hud-math'

const STAR_COUNT = 2000
const STARFIELD_SPIN_RAD_PER_SEC = 0.006
/** Dados mock isolados para validar HUD/radar/pips (substituíveis por estado real). */
const MOCK_CONTACT_COUNT = 8
const MOCK_WAVE_SECONDS = 12
const FREE_LOOK_MAX_YAW = 1.2
const FREE_LOOK_MAX_PITCH = 0.8

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
  private readonly mockState: HudState
  private readonly mockContacts: Contact[] = []
  private mockTime = 0
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

    this.starfield = createStarfield(STAR_COUNT)
    this.scene.add(this.starfield)

    // HUD diegético + pips alimentados por estado mock (isolado para M3/M4).
    for (let i = 0; i < MOCK_CONTACT_COUNT; i++) {
      this.mockContacts.push({ position: { x: 0, y: 0, z: 0 } })
    }
    this.mockState = {
      shield: 1,
      energy: 1,
      score: 0,
      wave: 1,
      contacts: this.mockContacts,
    }
    this.hud = new DiegeticHUD(this.cockpit.hudMesh)
    this.pips = new OffscreenPips(this.cockpit.offscreenPips)
    this.updateMockState(0)

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

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.running = false
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.handleResize)
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
    this.applyFreeLook()
    this.cockpit.update(dt)
    this.updateMockState(dt)
    this.hud.update(this.mockState, dt)
    this.pips.update(this.mockContacts, this.camera, dt)
    this.pipeline.render(this.scene, this.camera)
  }

  getInputManager(): InputManager {
    return this.inputManager
  }

  getVRBoxInput(): VRBoxInput {
    return this.vrBoxInput
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

    // Detach VR Box input when leaving VR_BOX.
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

    if (this.questXrSessionAttached) {
      this.questXrInput.detach()
      this.questXrSessionAttached = false
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

  /** Estado mínimo e determinístico; sem alocações no loop. */
  private updateMockState(dt: number): void {
    this.mockTime += dt
    const t = this.mockTime
    this.mockState.shield = 0.6 + 0.4 * Math.sin(t * 0.7)
    this.mockState.energy = 0.5 + 0.5 * Math.sin(t * 1.1 + 1)
    this.mockState.score = Math.floor(t * 10)
    this.mockState.wave = 1 + Math.floor(t / MOCK_WAVE_SECONDS)

    for (let i = 0; i < MOCK_CONTACT_COUNT; i++) {
      const contact: Contact | undefined = this.mockContacts[i]
      if (contact === undefined) continue
      const phase = (i / MOCK_CONTACT_COUNT) * 2 * Math.PI
      const radius = 35 + (i % 3) * 12
      const angle = phase + t * (0.25 + (i % 4) * 0.08)
      contact.position.x = Math.cos(angle) * radius
      contact.position.y = Math.sin(angle * 0.6 + phase) * 8
      contact.position.z = Math.sin(angle) * radius
    }
  }

  private resize(): void {
    this.pipeline.resize(window.innerWidth, window.innerHeight)
  }
}
