import * as THREE from 'three'

/** Console diegético: 512x256 conforme spec 4.4, gerado em código (ADR-04). */
const HUD_TEXTURE_WIDTH = 512
const HUD_TEXTURE_HEIGHT = 256
/** Retícula/projection mesh à frente da proa, distância do console conforme spec 4.4. */
const CROSSHAIR_Z = -60
/** Console inferior inclinado 35° em torno do eixo X. */
const CONSOLE_TILT_RAD = -THREE.MathUtils.degToRad(35)
/** Vignette de conforto colada à câmera (spec 4.4). */
const VIGNETTE_Z = -0.15
const VIGNETTE_RENDER_ORDER = 999

/**
 * Hierarquia 3D do cockpit (spec 4.4 / US-05).
 *
 * ShipRoot
 * ├── CockpitFrame
 * │   ├── CanopyStruts (LineSegments)
 * │   ├── DiegeticHUDMesh (Plane/Mesh, console inferior 35°)
 * │   └── CrosshairGroup (z: -60)
 * │       ├── MainReticle
 * │       ├── LeadIndicator
 * │       └── OffscreenPips (container)
 * ├── MuzzleLeft [-1.2, -0.4, -2.5]
 * ├── MuzzleRight [1.2, -0.4, -2.5]
 * └── PilotHeadRig [0, 0.35, 0.4]
 *     └── Camera (fov 75, near 0.05, far 1500)
 *         └── ComfortVignette (z: -0.15, renderOrder: 999, invisível)
 *
 * A cabeça (VR) move apenas a câmera dentro de PilotHeadRig; nave e mira
 * permanecem no ship/frame (ADR-01). Todo brilho vem de materiais emissivos
 * simples/aditivos — sem texturas externas e sem pós-processamento (ADR-04).
 */
export class CockpitRig {
  readonly root: THREE.Group
  readonly camera: THREE.PerspectiveCamera
  readonly hudMesh: THREE.Mesh
  readonly crosshairGroup: THREE.Group
  /** Container dos pips radiais (ADR-02) — preenchido por OffscreenPips. */
  readonly offscreenPips: THREE.Group

  private readonly hudTexture: THREE.CanvasTexture
  private readonly reticle: THREE.LineSegments
  private elapsed = 0

  constructor() {
    this.root = new THREE.Group()
    this.root.name = 'ShipRoot'

    const cockpitFrame = new THREE.Group()
    cockpitFrame.name = 'CockpitFrame'
    this.root.add(cockpitFrame)

    cockpitFrame.add(this.createCanopyStruts())

    const hud = this.createHud()
    this.hudTexture = hud.texture
    this.hudMesh = hud.mesh
    cockpitFrame.add(this.hudMesh)

    this.crosshairGroup = new THREE.Group()
    this.crosshairGroup.name = 'CrosshairGroup'
    this.crosshairGroup.position.z = CROSSHAIR_Z
    cockpitFrame.add(this.crosshairGroup)

    this.reticle = this.createMainReticle()
    this.crosshairGroup.add(this.reticle)
    this.crosshairGroup.add(this.createLeadIndicator())

    this.offscreenPips = new THREE.Group()
    this.offscreenPips.name = 'OffscreenPips'
    this.crosshairGroup.add(this.offscreenPips)

    const muzzleLeft = new THREE.Object3D()
    muzzleLeft.name = 'MuzzleLeft'
    muzzleLeft.position.set(-1.2, -0.4, -2.5)
    this.root.add(muzzleLeft)

    const muzzleRight = new THREE.Object3D()
    muzzleRight.name = 'MuzzleRight'
    muzzleRight.position.set(1.2, -0.4, -2.5)
    this.root.add(muzzleRight)

    const pilotHeadRig = new THREE.Group()
    pilotHeadRig.name = 'PilotHeadRig'
    pilotHeadRig.position.set(0, 0.35, 0.4)
    this.root.add(pilotHeadRig)

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1500)
    this.camera.name = 'Camera'
    pilotHeadRig.add(this.camera)

    this.camera.add(this.createComfortVignette())
  }

  /** Animação puramente decorativa e sem alocações no hot-loop. */
  update(dt: number): void {
    this.elapsed += dt
    const pulse = 1 + Math.sin(this.elapsed * 2.4) * 0.03
    this.reticle.scale.set(pulse, pulse, 1)
  }

  /** Libera geometry/material/texture geradas proceduralmente. */
  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose())
        } else {
          material.dispose()
        }
      }
    })
    this.hudTexture.dispose()
    this.root.clear()
  }

  private createCanopyStruts(): THREE.LineSegments {
    // Montantes periféricos: postes laterais, travessas e diagonais superiores.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -1.05, -0.55, -1.1, -0.78, 0.75, -1.0,
          1.05, -0.55, -1.1, 0.78, 0.75, -1.0,
          -0.78, 0.75, -1.0, 0.78, 0.75, -1.0,
          -1.05, -0.55, -1.1, 1.05, -0.55, -1.1,
          -0.78, 0.75, -1.0, -0.35, 0.42, -1.25,
          0.78, 0.75, -1.0, 0.35, 0.42, -1.25,
        ],
        3,
      ),
    )
    const material = new THREE.LineBasicMaterial({
      color: 0x59d8ff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })
    const struts = new THREE.LineSegments(geometry, material)
    struts.name = 'CanopyStruts'
    return struts
  }

  private createHud(): { mesh: THREE.Mesh; texture: THREE.CanvasTexture } {
    const canvas = document.createElement('canvas')
    canvas.width = HUD_TEXTURE_WIDTH
    canvas.height = HUD_TEXTURE_HEIGHT

    const ctx = canvas.getContext('2d')
    if (ctx !== null) {
      ctx.clearRect(0, 0, HUD_TEXTURE_WIDTH, HUD_TEXTURE_HEIGHT)
      ctx.strokeStyle = 'rgba(90, 220, 255, 0.55)'
      ctx.lineWidth = 4
      ctx.strokeRect(6, 6, HUD_TEXTURE_WIDTH - 12, HUD_TEXTURE_HEIGHT - 12)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(256, 150)
      ctx.lineTo(256, HUD_TEXTURE_HEIGHT - 10)
      ctx.stroke()
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), material)
    mesh.name = 'DiegeticHUDMesh'
    mesh.position.set(0, -0.42, -0.85)
    mesh.rotation.x = CONSOLE_TILT_RAD
    return { mesh, texture }
  }

  private createMainReticle(): THREE.LineSegments {
    // Quatro marcas cardinais com gap central + losango pequeno.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          -1.6, 0, 0, -0.5, 0, 0,
          0.5, 0, 0, 1.6, 0, 0,
          0, -1.6, 0, 0, -0.5, 0,
          0, 0.5, 0, 0, 1.6, 0,
          0, 0.18, 0, 0.18, 0, 0,
          0.18, 0, 0, 0, -0.18, 0,
          0, -0.18, 0, -0.18, 0, 0,
          -0.18, 0, 0, 0, 0.18, 0,
        ],
        3,
      ),
    )
    const material = new THREE.LineBasicMaterial({
      color: 0x8ffcff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const reticle = new THREE.LineSegments(geometry, material)
    reticle.name = 'MainReticle'
    reticle.renderOrder = 10
    return reticle
  }

  private createLeadIndicator(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffc14d,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const lead = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), material)
    lead.name = 'LeadIndicator'
    lead.position.set(0, 0, 0.2)
    lead.renderOrder = 11
    return lead
  }

  private createComfortVignette(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.12,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const vignette = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.24, 32), material)
    vignette.name = 'ComfortVignette'
    vignette.position.z = VIGNETTE_Z
    vignette.renderOrder = VIGNETTE_RENDER_ORDER
    vignette.visible = false // dinâmica em strafe/boost (fase posterior)
    return vignette
  }
}
