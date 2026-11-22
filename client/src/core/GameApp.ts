import * as THREE from 'three'
import { CockpitRig } from './CockpitRig'
import { RenderPipeline, type RenderMode } from './RenderPipeline'
import { createStarfield } from './Starfield'

const STAR_COUNT = 2000
const STARFIELD_SPIN_RAD_PER_SEC = 0.006

/** Bootstrap da cena Three.js: cena, câmera, renderer, loop e ciclo de vida. */
export class GameApp {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer

  private readonly container: HTMLElement
  private readonly cockpit: CockpitRig
  private readonly starfield: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly pipeline: RenderPipeline
  private readonly clock = new THREE.Clock()
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
    })
    const canvas = this.renderer.domElement
    canvas.style.position = 'fixed'
    canvas.style.inset = '0'
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    this.container.append(canvas)

    // Iluminação mínima; brilho neste projeto vem de emissivos/Fresnel, não de bloom (ADR-04).
    this.scene.add(new THREE.AmbientLight(0x334466, 1))

    this.starfield = createStarfield(STAR_COUNT)
    this.scene.add(this.starfield)

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
    this.pipeline.dispose()
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
    this.cockpit.update(dt)
    this.pipeline.render(this.scene, this.camera)
  }

  private resize(): void {
    this.pipeline.resize(window.innerWidth, window.innerHeight)
  }
}
