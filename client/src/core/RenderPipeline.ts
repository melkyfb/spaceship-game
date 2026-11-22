import * as THREE from 'three'
import {
  BARREL_K1,
  BARREL_K2,
  DEFAULT_IPD_MM,
  IPD_STORAGE_KEY,
  XR_REFERENCE_SPACE_TYPE,
  XR_SESSION_MODE,
  clampIpdMm,
  MAX_DPR,
} from './render-config'

export type RenderMode = 'FLAT' | 'VR_BOX' | 'QUEST_3'

export interface RenderPipelineOptions {
  renderer: THREE.WebGLRenderer
  /** Cabeça do piloto (filha de PilotHeadRig); as câmeras de olho herdam seu pose. */
  camera: THREE.PerspectiveCamera
  /** ShipRoot — usado para localizar o PilotHeadRig no recenter. */
  cockpitRoot: THREE.Object3D
  /** Opcional: onde ancorar o botão DOM "Enter VR". */
  container?: HTMLElement
  /** Injeta a superfície WebXR (testes); por padrão usa `navigator.xr`. */
  xr?: XrSystemLike | null
  /** Hooks opcionais para integrar input XR (Quest) ao ciclo de vida da sessão. */
  onXrSessionStart?: (session: XrSessionLike) => void
  onXrSessionEnd?: () => void
}

/** Superfície WebXR mínima consumida aqui; o input Quest completo chega em M3. */
export interface XrSessionLike {
  addEventListener(type: 'end', listener: () => void): void
  removeEventListener(type: 'end', listener: () => void): void
  end(): Promise<void>
}

export interface XrSystemLike {
  isSessionSupported(mode: string): Promise<boolean>
  requestSession(mode: string, init?: { optionalFeatures?: string[] }): Promise<XrSessionLike>
}

/** Estado observável do botão "Enter VR" (expõe falhas na UI, não só no console). */
export type XrStatus = 'idle' | 'unsupported' | 'ready' | 'entering' | 'error' | 'in-session'

type WebXrSession = Parameters<THREE.WebGLRenderer['xr']['setSession']>[0]

interface BarrelUniforms {
  [uniform: string]: THREE.IUniform
  uLeft: { value: THREE.Texture | null }
  uRight: { value: THREE.Texture | null }
  uK1: { value: number }
  uK2: { value: number }
}

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Brown-Conrady radial: amostra a textura do olho com r² e r⁴ (k1/k2 da spec).
 * Cada metade da tela é um olho; fora do intervalo [0,1] o pixel fica preto
 * (canto arredondado do visor). Nenhuma textura ou shader é carregado de fora (ADR-04).
 */
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uLeft;
uniform sampler2D uRight;
uniform float uK1;
uniform float uK2;
varying vec2 vUv;

vec2 brownConrady(vec2 uv) {
  vec2 centered = uv - 0.5;
  float r2 = dot(centered, centered);
  float scale = 1.0 + uK1 * r2 + uK2 * r2 * r2;
  return 0.5 + centered * scale;
}

void main() {
  float eye = step(0.5, vUv.x);
  vec2 localUv = vec2(vUv.x * 2.0 - eye, vUv.y);
  vec2 warped = brownConrady(localUv);

  if (warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 leftColor = texture2D(uLeft, warped);
  vec4 rightColor = texture2D(uRight, warped);
  gl_FragColor = mix(leftColor, rightColor, eye);
  #include <colorspace_fragment>
}
`

/**
 * Seleciona/ativa a saída de render (US-06): FLAT, VR_BOX estéreo com barrel
 * Brown-Conrady, ou QUEST_3 via WebXR `immersive-vr` + espaço `local`.
 *
 * Hot-loop sem alocações: olhos, render targets, quad e uniforms são criados uma
 * vez no construtor; `render()` apenas troca targets e desenha (ADR-04/performance).
 * A cabeça continua controlando somente a câmera dentro de PilotHeadRig (ADR-01).
 */
export class RenderPipeline {
  private readonly renderer: THREE.WebGLRenderer
  private readonly headCamera: THREE.PerspectiveCamera
  private readonly container: HTMLElement | undefined
  private readonly pilotHeadRig: THREE.Object3D | null
  private readonly baseHeadPosition: THREE.Vector3
  private readonly baseHeadQuaternion: THREE.Quaternion

  private readonly eyeL: THREE.PerspectiveCamera
  private readonly eyeR: THREE.PerspectiveCamera
  private readonly targetL: THREE.WebGLRenderTarget
  private readonly targetR: THREE.WebGLRenderTarget
  private readonly quadScene: THREE.Scene
  private readonly quadCamera: THREE.OrthographicCamera
  private readonly quadGeometry: THREE.PlaneGeometry
  private readonly quadMaterial: THREE.ShaderMaterial
  private readonly uniforms: BarrelUniforms

  private readonly xr: XrSystemLike | null
  private readonly onXrSessionStart: ((session: XrSessionLike) => void) | null
  private readonly onXrSessionEnd: (() => void) | null

  private mode: RenderMode = 'FLAT'
  private ipdMm: number
  private dpr = 1
  private lastTargetW = 1
  private lastTargetH = 1
  private vrButton: HTMLButtonElement | null = null
  private activeSession: XrSessionLike | null = null
  private xrStatus: XrStatus = 'idle'
  private disposed = false

  constructor(options: RenderPipelineOptions) {
    this.renderer = options.renderer
    this.headCamera = options.camera
    this.container = options.container
    this.xr = options.xr !== undefined ? options.xr : this.readNavigatorXr()
    this.onXrSessionStart = options.onXrSessionStart ?? null
    this.onXrSessionEnd = options.onXrSessionEnd ?? null

    const head = this.headCamera
    this.pilotHeadRig = options.cockpitRoot.getObjectByName('PilotHeadRig') ?? null
    this.baseHeadPosition = this.pilotHeadRig?.position.clone() ?? new THREE.Vector3()
    this.baseHeadQuaternion = this.pilotHeadRig?.quaternion.clone() ?? new THREE.Quaternion()

    this.ipdMm = this.readIpd()

    // Câmeras de olho são filhas da câmera da cabeça: herdam o pose do PilotHeadRig.
    this.eyeL = new THREE.PerspectiveCamera()
    this.eyeR = new THREE.PerspectiveCamera()
    this.eyeL.name = 'EyeLeft'
    this.eyeR.name = 'EyeRight'
    head.add(this.eyeL, this.eyeR)
    this.applyIpd()

    const targetOptions: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false,
    }
    this.targetL = new THREE.WebGLRenderTarget(1, 1, targetOptions)
    this.targetR = new THREE.WebGLRenderTarget(1, 1, targetOptions)

    this.uniforms = {
      uLeft: { value: this.targetL.texture },
      uRight: { value: this.targetR.texture },
      uK1: { value: BARREL_K1 },
      uK2: { value: BARREL_K2 },
    }
    this.quadGeometry = new THREE.PlaneGeometry(2, 2)
    this.quadMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    const quad = new THREE.Mesh(this.quadGeometry, this.quadMaterial)
    quad.frustumCulled = false
    this.quadScene = new THREE.Scene()
    this.quadScene.add(quad)
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
    this.quadCamera.position.z = 1

    this.syncEyeCameras()
  }

  getMode(): RenderMode {
    return this.mode
  }

  getIpdMm(): number {
    return this.ipdMm
  }

  /** Estado do botão VR — permite à UI/testes detectar falhas sem ler o console. */
  getXrStatus(): XrStatus {
    return this.xrStatus
  }

  /** Sessão WebXR ativa (Quest), se houver. */
  getActiveXrSession(): XrSessionLike | null {
    return this.activeSession
  }

  /** Troca de modo; XR nunca é solicitado aqui (requestSession exige gesto do usuário). */
  async setMode(mode: RenderMode): Promise<void> {
    if (this.disposed) return

    if (mode !== 'QUEST_3') {
      const session = this.renderer.xr.getSession()
      if (session !== null) void session.end().catch(() => {})
      this.removeVrButton()
      this.xrStatus = 'idle'
    }

    this.mode = mode
    this.renderer.xr.enabled = mode === 'QUEST_3'

    if (mode === 'QUEST_3') {
      this.renderer.xr.setReferenceSpaceType(XR_REFERENCE_SPACE_TYPE)
      await this.ensureVrButton()
    }
  }

  /** Chamado a cada frame; nenhuma alocação, closure ou vec temporário. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.disposed) return

    if (this.mode === 'VR_BOX') {
      this.renderVrBox(scene)
      return
    }

    this.renderer.setRenderTarget(null)
    this.renderer.render(scene, camera)
  }

  resize(width: number, height: number): void {
    if (this.disposed) return
    const w = Math.max(1, Math.floor(width))
    const h = Math.max(1, Math.floor(height))
    this.dpr = Math.min(Math.max(this.readDevicePixelRatio(), 1), MAX_DPR)

    // Em XR o próprio runtime dimensiona o framebuffer.
    if (!this.renderer.xr.isPresenting) {
      this.renderer.setPixelRatio(this.dpr)
      this.renderer.setSize(w, h, false)
    }

    this.headCamera.aspect = w / h
    this.headCamera.updateProjectionMatrix()
    this.syncEyeCameras()

    // Redimensiona apenas quando o tamanho realmente muda (evita setSize em
    // todo resize e em modos que não usam os targets, como FLAT/QUEST_3).
    const targetW = Math.max(1, Math.floor((w * this.dpr) / 2))
    const targetH = Math.max(1, Math.floor(h * this.dpr))
    if (targetW !== this.lastTargetW || targetH !== this.lastTargetH) {
      this.targetL.setSize(targetW, targetH)
      this.targetR.setSize(targetW, targetH)
      this.lastTargetW = targetW
      this.lastTargetH = targetH
      this.uniforms.uLeft.value = this.targetL.texture
      this.uniforms.uRight.value = this.targetR.texture
    }
  }

  /** Dev hook (teclas no main); D-Pad do gamepad Quest fica para M3. */
  adjustIpd(deltaMm: number): void {
    const next = clampIpdMm(this.ipdMm + deltaMm)
    if (next === this.ipdMm) return
    this.ipdMm = next
    this.applyIpd()
    this.persistIpd()
  }

  /**
   * Recenter: devolve o PilotHeadRig à posição/yaw do assento do piloto (ADR-01).
   * Em QUEST_3 apresentando WebXR, também compensa o reference space `local` via
   * `getOffsetReferenceSpace(new XRRigidTransform(...))` para aplicar offset
   * rotacional (yaw) e translacional (x, y, z) relativo ao assento do piloto.
   */
  recenter(): void {
    if (this.pilotHeadRig !== null) {
      this.pilotHeadRig.position.copy(this.baseHeadPosition)
      this.pilotHeadRig.quaternion.copy(this.baseHeadQuaternion)
    }
    this.recenterXrReferenceSpace()
  }

  private recenterXrReferenceSpace(): void {
    if (this.mode !== 'QUEST_3') return
    if (!this.renderer.xr.isPresenting) return
    const referenceSpace = this.renderer.xr.getReferenceSpace()
    if (referenceSpace === null) return
    if (typeof XRRigidTransform === 'undefined') return

    const xrCamera = this.renderer.xr.getCamera()
    const position = xrCamera.position
    const orientation = xrCamera.quaternion

    // Extrai apenas yaw para manter o recenter alinhado ao assento do piloto
    // sem introduzir roll/pitch do headset no offset do reference space.
    const euler = new THREE.Euler().setFromQuaternion(orientation, 'YXZ')
    const yawOnly = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      euler.y,
    )

    // O offset descreve a origem do novo espaço no espaço atual: colocar a origem
    // no pose atual do headset (yaw + x,y,z) faz o headset atual mapear para a
    // origem local, que corresponde ao assento do piloto (PilotHeadRig base).
    const offsetTransform = new XRRigidTransform(
      { x: position.x, y: position.y, z: position.z, w: 1 },
      { x: yawOnly.x, y: yawOnly.y, z: yawOnly.z, w: yawOnly.w },
    )
    const offsetReferenceSpace = referenceSpace.getOffsetReferenceSpace(offsetTransform)
    this.renderer.xr.setReferenceSpace(offsetReferenceSpace)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.removeVrButton()
    const session = this.renderer.xr.getSession()
    if (session !== null) void session.end().catch(() => {})
    this.renderer.xr.enabled = false

    this.headCamera.remove(this.eyeL, this.eyeR)
    this.targetL.dispose()
    this.targetR.dispose()
    this.quadGeometry.dispose()
    this.quadMaterial.dispose()
    this.quadScene.clear()
  }

  private renderVrBox(scene: THREE.Scene): void {
    const head = this.headCamera
    this.eyeL.projectionMatrix.copy(head.projectionMatrix)
    this.eyeL.projectionMatrixInverse.copy(head.projectionMatrixInverse)
    this.eyeR.projectionMatrix.copy(head.projectionMatrix)
    this.eyeR.projectionMatrixInverse.copy(head.projectionMatrixInverse)

    this.renderer.setRenderTarget(this.targetL)
    this.renderer.render(scene, this.eyeL)

    this.renderer.setRenderTarget(this.targetR)
    this.renderer.render(scene, this.eyeR)

    // Composição fullscreen: metade esquerda/direita já com barrel aplicado.
    this.renderer.setRenderTarget(null)
    this.renderer.render(this.quadScene, this.quadCamera)
  }

  private applyIpd(): void {
    const halfMeters = this.ipdMm / 2000
    this.eyeL.position.x = -halfMeters
    this.eyeR.position.x = halfMeters
  }

  private syncEyeCameras(): void {
    this.syncEye(this.eyeL)
    this.syncEye(this.eyeR)
  }

  private syncEye(eye: THREE.PerspectiveCamera): void {
    const head = this.headCamera
    eye.fov = head.fov
    eye.aspect = head.aspect
    eye.near = head.near
    eye.far = head.far
    eye.zoom = head.zoom
    eye.updateProjectionMatrix()
  }

  private readDevicePixelRatio(): number {
    return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  }

  private readIpd(): number {
    if (typeof window === 'undefined') return DEFAULT_IPD_MM
    try {
      const raw = window.localStorage.getItem(IPD_STORAGE_KEY)
      return raw === null ? DEFAULT_IPD_MM : clampIpdMm(Number(raw))
    } catch {
      return DEFAULT_IPD_MM
    }
  }

  private persistIpd(): void {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(IPD_STORAGE_KEY, String(this.ipdMm))
    } catch {
      // localStorage pode ser bloqueado; o valor em memória continua válido.
    }
  }

  private readNavigatorXr(): XrSystemLike | null {
    if (typeof navigator === 'undefined') return null
    return (navigator as Navigator & { xr?: XrSystemLike }).xr ?? null
  }

  private async ensureVrButton(): Promise<void> {
    const xr = this.xr
    if (xr === null) {
      this.xrStatus = 'unsupported'
      return
    }
    let supported = false
    try {
      supported = await xr.isSessionSupported(XR_SESSION_MODE)
    } catch {
      supported = false
    }
    if (!supported) {
      this.xrStatus = 'unsupported'
      return
    }
    if (this.disposed || this.mode !== 'QUEST_3') return
    if (this.vrButton !== null) return
    this.xrStatus = 'ready'

    const button = document.createElement('button')
    button.type = 'button'
    button.id = 'enter-vr'
    button.textContent = 'Enter VR'
    button.style.position = 'fixed'
    button.style.right = '0.75rem'
    button.style.bottom = '0.75rem'
    button.style.zIndex = '2'
    button.style.padding = '0.5rem 1rem'
    button.style.background = 'rgba(5, 7, 15, 0.85)'
    button.style.color = '#8ffcff'
    button.style.border = '1px solid #59d8ff'
    button.style.borderRadius = '0.25rem'
    button.addEventListener('click', this.handleVrButtonClick)
    ;(this.container ?? document.body).append(button)
    this.vrButton = button
  }

  private removeVrButton(): void {
    if (this.vrButton === null) return
    this.vrButton.removeEventListener('click', this.handleVrButtonClick)
    this.vrButton.remove()
    this.vrButton = null
  }

  private readonly handleVrButtonClick = (): void => {
    void this.enterVr()
  }

  private async enterVr(): Promise<void> {
    const xr = this.xr
    if (xr === null || this.disposed) return
    this.xrStatus = 'entering'
    if (this.vrButton !== null) {
      this.vrButton.disabled = true
      this.vrButton.textContent = 'Entering VR…'
    }
    try {
      const session = await xr.requestSession(XR_SESSION_MODE, {
        optionalFeatures: ['local-floor', 'hand-tracking', 'layers'],
      })
      this.renderer.xr.setReferenceSpaceType(XR_REFERENCE_SPACE_TYPE)
      await this.renderer.xr.setSession(session as unknown as WebXrSession)
      this.activeSession = session
      session.addEventListener('end', this.handleXrSessionEnd)
      this.xrStatus = 'in-session'
      if (this.vrButton !== null) this.vrButton.disabled = true
      this.onXrSessionStart?.(session)
    } catch (error) {
      console.warn('[render] unable to start immersive-vr session', error)
      this.xrStatus = 'error'
      // Falha visível na UI: texto de erro e botão reabilitado para nova tentativa.
      if (this.vrButton !== null) {
        this.vrButton.disabled = false
        this.vrButton.textContent = 'VR failed — retry'
      }
    }
  }

  private readonly handleXrSessionEnd = (): void => {
    if (this.activeSession !== null) {
      this.activeSession.removeEventListener('end', this.handleXrSessionEnd)
      this.activeSession = null
    }
    if (this.disposed || this.mode !== 'QUEST_3') {
      this.xrStatus = 'idle'
      this.onXrSessionEnd?.()
      return
    }
    this.xrStatus = 'ready'
    if (this.vrButton !== null) {
      this.vrButton.disabled = false
      this.vrButton.textContent = 'Enter VR'
    }
    this.onXrSessionEnd?.()
  }
}
