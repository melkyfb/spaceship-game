import * as THREE from 'three'
import { CockpitRig } from './CockpitRig'
import { createStarfield } from './Starfield'

const STAR_COUNT = 2000
const STARFIELD_SPIN_RAD_PER_SEC = 0.006
const MAX_DPR = 2

/** Bootstrap da cena Three.js: cena, câmera, renderer, loop e ciclo de vida. */
export class GameApp {
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly renderer: THREE.WebGLRenderer

  private readonly container: HTMLElement
  private readonly cockpit: CockpitRig
  private readonly starfield: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly clock = new THREE.Clock()
  private frameId: number | null = null
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
    if (this.disposed || this.frameId !== null) return
    this.clock.start()
    this.frameId = requestAnimationFrame(this.tick)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId)
      this.frameId = null
    }
    window.removeEventListener('resize', this.handleResize)
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
    this.renderer.render(this.scene, this.camera)
    this.frameId = requestAnimationFrame(this.tick)
  }

  private resize(): void {
    const width = window.innerWidth
    const height = window.innerHeight
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }
}
