import * as THREE from 'three'
import { computePip, type Contact, type PipResult } from './hud-math'

/** Pool fixo de setas — nunca cresce no hot-loop. */
const MAX_PIPS = 16
/** Raio do anel de pips ao redor da retícula, em unidades do grupo da retícula. */
const PIP_RING_RADIUS = 12
const PIP_SIZE = 1.2

/**
 * Indicadores radiais de ameaças fora do FOV (ADR-02: paridade tática com o
 * radar 3D). As setas vivem no grupo `OffscreenPips` do CrosshairGroup; o
 * ângulo é calculado no espaço da câmera e a seta aponta para fora.
 *
 * `update` não aloca: usa dois Vector3 de scratch, um PipResult de scratch e
 * apenas reescreve transforms dos meshes do pool.
 */
export class OffscreenPips {
  private readonly container: THREE.Group
  private readonly geometry: THREE.BufferGeometry
  private readonly material: THREE.MeshBasicMaterial
  private readonly pips: THREE.Mesh[] = []

  private readonly viewScratch = new THREE.Vector3()
  /** Vector4 preserva as coordenadas de clip (applyMatrix4 não divide por w). */
  private readonly clipScratch = new THREE.Vector4()
  private readonly pipScratch: PipResult = { show: false, x: 0, y: 0, rot: 0 }

  private elapsed = 0

  constructor(container: THREE.Group) {
    this.container = container

    // Triângulo apontando para +x; rotation.z = ângulo o gira para fora.
    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          PIP_SIZE * 0.75, 0, 0,
          -PIP_SIZE * 0.5, PIP_SIZE * 0.45, 0,
          -PIP_SIZE * 0.5, -PIP_SIZE * 0.45, 0,
        ],
        3,
      ),
    )

    this.material = new THREE.MeshBasicMaterial({
      color: 0xffa040,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })

    for (let i = 0; i < MAX_PIPS; i++) {
      const pip = new THREE.Mesh(this.geometry, this.material)
      pip.name = `OffscreenPip_${i}`
      pip.renderOrder = 12
      pip.visible = false
      this.pips.push(pip)
      this.container.add(pip)
    }
  }

  /** Reposiciona as setas conforme ameaças dentro/fora do FOV da câmera. */
  update(contacts: readonly Contact[], camera: THREE.Camera, dt: number): void {
    this.elapsed = (this.elapsed + dt) % (2 * Math.PI)
    const pulse = 1 + Math.sin(this.elapsed * 4) * 0.06
    camera.updateMatrixWorld()

    for (let i = 0; i < MAX_PIPS; i++) {
      const pip: THREE.Mesh | undefined = this.pips[i]
      if (pip === undefined) continue

      const contact: Contact | undefined = contacts[i]
      if (contact === undefined) {
        pip.visible = false
        continue
      }

      this.viewScratch.set(contact.position.x, contact.position.y, contact.position.z)
      camera.worldToLocal(this.viewScratch)
      const behind = this.viewScratch.z > 0
      this.clipScratch
        .set(this.viewScratch.x, this.viewScratch.y, this.viewScratch.z, 1)
        .applyMatrix4(camera.projectionMatrix)

      // Em projeção perspectiva clip.w = -z_view, então |clip.x| > profundidade
      // equivale a |ndc.x| > 1 — sem depender da divisão implícita do Vector3.
      const depth = Math.abs(this.viewScratch.z)
      const offscreen =
        behind || Math.abs(this.clipScratch.x) > depth || Math.abs(this.clipScratch.y) > depth
      let angle = Math.atan2(this.viewScratch.y, this.viewScratch.x)
      if (behind) angle += Math.PI

      const result = computePip(angle, offscreen, this.pipScratch)
      if (!result.show) {
        pip.visible = false
        continue
      }

      pip.visible = true
      pip.position.set(result.x * PIP_RING_RADIUS, result.y * PIP_RING_RADIUS, 0)
      pip.rotation.z = result.rot
      pip.scale.setScalar(pulse)
    }
  }

  /** Remove as setas do container e libera geometry/material compartilhados. */
  dispose(): void {
    for (const pip of this.pips) {
      this.container.remove(pip)
    }
    this.pips.length = 0
    this.geometry.dispose()
    this.material.dispose()
  }
}
