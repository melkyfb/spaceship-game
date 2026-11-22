// Física determinística de 30Hz (US-03). Isomórfico: sem DOM/Three/Node.
// Zero-alloc no hot-loop: todos os buffers intermediários são pré-alocados no
// escopo do módulo e reutilizados. Estado é mutado in-place pelas funções.
import { quat, vec3 } from 'gl-matrix';
import { SHIP_CONFIG, WORLD_CONFIG } from './constants';
import { clamp, isFiniteNumber } from './math';
import type { ShipState, ShipCommand } from './types';

/** Passo fixo de simulação (ADR-06): 1/30 s. */
export const FIXED_DT = 1 / WORLD_CONFIG.FIXED_TICK_RATE;

/** Abaixo desta velocidade angular (rad/s) o quatérnio é apenas copiado. */
const OMEGA_EPS = 1e-5;
/** Largura da rampa da mola: (515 - 450) / 50 = 1.3 = u máx. no limite duro. */
const BOUNDARY_RAMP_WIDTH = 50;
const BOUNDARY_U_MAX = 1.3;

// Usa os tipos do gl-matrix (que aceitam Float32Array, tuplas e IndexedCollection)
// para que os scratch buffers e os arrays de ShipState sejam intercambiáveis.
type Vec3 = ReturnType<typeof vec3.create>;
type Vec4 = ReturnType<typeof quat.create>;

// Scratch de módulo — criados uma única vez, nunca dentro de tick().
const SCRATCH_LOCAL_ACCEL = vec3.create();
const SCRATCH_WORLD_ACCEL = vec3.create();
const SCRATCH_ANG_ACCEL = vec3.create();
const SCRATCH_BASE_QUAT = quat.create();
const SCRATCH_DELTA_QUAT = quat.create();

/** Non-finite (NaN/Infinity) nunca entra na simulação: vira 0. */
function finiteOrZero(x: number): number {
  return isFiniteNumber(x) ? x : 0;
}

// Leituras defensivas: `?? 0` cobre o noUncheckedIndexedAccess em Float32Array.
function x3(v: Vec3): number { return finiteOrZero(v[0] ?? 0); }
function y3(v: Vec3): number { return finiteOrZero(v[1] ?? 0); }
function z3(v: Vec3): number { return finiteOrZero(v[2] ?? 0); }

/** Copia q -> out sanitizando; quaternion totalmente degenerado vira identidade. */
function copyQuatSanitized(src: Vec4, out: Vec4): void {
  const x = finiteOrZero(src[0] ?? 0);
  const y = finiteOrZero(src[1] ?? 0);
  const z = finiteOrZero(src[2] ?? 0);
  const w = finiteOrZero(src[3] ?? 1);
  if (x === 0 && y === 0 && z === 0 && w === 0) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1;
    return;
  }
  out[0] = x; out[1] = y; out[2] = z; out[3] = w;
}

/**
 * Integração exponencial: v_out = (v + a*dt) * exp(-k*dt).
 *
 * Damping exponencial é incondicionalmente estável e reproduz a velocidade
 * terminal do spec sem clamp explícito (THRUST_ACCEL/LINEAR_DRAG = 117/1.8 =
 * 65 = MAX_SPEED; com boost = 113.75). In-place (out === vel) é seguro: todos
 * os componentes são lidos antes de qualquer escrita.
 */
export function integrateLinearVelocity(
  vel: Vec3,
  accel: Vec3,
  dt: number,
  dragK: number,
  outVel: Vec3,
): void {
  const h = finiteOrZero(dt);
  const decay = Math.exp(-finiteOrZero(dragK) * h);
  const vx = x3(vel), vy = y3(vel), vz = z3(vel);
  const ax = x3(accel), ay = y3(accel), az = z3(accel);
  outVel[0] = (vx + ax * h) * decay;
  outVel[1] = (vy + ay * h) * decay;
  outVel[2] = (vz + az * h) * decay;
}

/** Mesma lei de integração do linear, aplicada à velocidade angular. */
export function integrateAngularVelocity(
  angVel: Vec3,
  angAccel: Vec3,
  dt: number,
  dragK: number,
  outAngVel: Vec3,
): void {
  integrateLinearVelocity(angVel, angAccel, dt, dragK, outAngVel);
}

/**
 * Integra a orientação com Δq = (ângulo = ω*dt):
 *   ω = ||angVel||;  Δq = (âx*sin(θ/2)/ω, ..., cos(θ/2));
 *   q' = normalize(q ⊗ Δq)   (convenção: angVel no quadro do corpo).
 *
 * Se ω <= 1e-5 (ou dt inválido), apenas copia q — evita divisão por zero e
 * preserva bit-a-bit a orientação em repouso.
 */
export function integrateRotation(
  rotQuat: Vec4,
  angVel: Vec3,
  dt: number,
  outRotQuat: Vec4,
): void {
  const wx = x3(angVel), wy = y3(angVel), wz = z3(angVel);
  const omega = Math.sqrt(wx * wx + wy * wy + wz * wz);
  const h = finiteOrZero(dt);
  if (!(omega > OMEGA_EPS) || !(h > 0)) {
    copyQuatSanitized(rotQuat, outRotQuat);
    return;
  }
  const half = omega * h * 0.5;
  const s = Math.sin(half) / omega;
  SCRATCH_DELTA_QUAT[0] = wx * s;
  SCRATCH_DELTA_QUAT[1] = wy * s;
  SCRATCH_DELTA_QUAT[2] = wz * s;
  SCRATCH_DELTA_QUAT[3] = Math.cos(half);
  copyQuatSanitized(rotQuat, SCRATCH_BASE_QUAT);
  quat.multiply(outRotQuat, SCRATCH_BASE_QUAT, SCRATCH_DELTA_QUAT);
  quat.normalize(outRotQuat, outRotQuat);
}

/**
 * Fronteira magnética esférica, ativa apenas quando r = ||p|| > 450:
 *
 *   u        = clamp((r - 450) / 50, 0, 1.3)
 *   n        = p / r
 *   a_mola   = -n * 140 * u²            -> SOMADO em outAccel (preserva empuxo)
 *   vr       = dot(v, n)
 *   se vr>0: v -= n * vr * 3.0 * FIXED_DT   (damping radial Euler a 30Hz)
 *
 * Fórmula do damping é a literal do spec; usa FIXED_DT porque o passo é fixo
 * (ADR-06 — o cliente nunca envia dt arbitrário). Sem isso, velocidade radial
 * de saída em boost escaparia: a mola quadrática sozinha é tardia na rampa.
 */
export function applyMagneticBoundary(
  pos: Vec3,
  vel: Vec3,
  outAccel: Vec3,
): void {
  const px = x3(pos), py = y3(pos), pz = z3(pos);
  const r = Math.sqrt(px * px + py * py + pz * pz);
  if (!isFiniteNumber(r) || r <= WORLD_CONFIG.SOFT_BOUNDARY_START) return;

  const nx = px / r, ny = py / r, nz = pz / r;
  const u = clamp(
    (r - WORLD_CONFIG.SOFT_BOUNDARY_START) / BOUNDARY_RAMP_WIDTH,
    0,
    BOUNDARY_U_MAX,
  );
  const spring = -WORLD_CONFIG.BOUNDARY_SPRING_K * u * u;
  outAccel[0] = finiteOrZero((outAccel[0] ?? 0) + nx * spring);
  outAccel[1] = finiteOrZero((outAccel[1] ?? 0) + ny * spring);
  outAccel[2] = finiteOrZero((outAccel[2] ?? 0) + nz * spring);

  const vx = x3(vel), vy = y3(vel), vz = z3(vel);
  const vr = vx * nx + vy * ny + vz * nz;
  if (vr > 0) {
    const damp = vr * WORLD_CONFIG.BOUNDARY_RADIAL_DAMPING * FIXED_DT;
    vel[0] = finiteOrZero(vx - nx * damp);
    vel[1] = finiteOrZero(vy - ny * damp);
    vel[2] = finiteOrZero(vz - nz * damp);
  }
}

/** Eixo de comando: non-finite => 0, depois clamp em [-1, 1]. */
function cmdAxis(value: number): number {
  return clamp(finiteOrZero(value), -1, 1);
}

/**
 * Avança a nave um passo fixo. Escreve somente nos arrays já existentes em
 * `state` — nenhuma alocação por tick. Ordem: sanitizar -> comandos ->
 * aceleração local->mundo -> fronteira -> integrar -> posição -> rotação.
 *
 * Fora do escopo desta task (fica para a lógica de jogo): shield/energy,
 * cooldowns de tiro, colisões e tick de rede.
 */
export function stepShip(
  state: ShipState,
  cmd: ShipCommand,
  dt: number = FIXED_DT,
): void {
  // ADR-06: passo fixo; valores inválidos caem no padrão em vez de infectar o estado.
  const h = isFiniteNumber(dt) && dt > 0 ? dt : FIXED_DT;

  // 1) saneamento do estado — NaN/Infinity não viram posição/rotação.
  const px = x3(state.pos), py = y3(state.pos), pz = z3(state.pos);
  state.pos[0] = px; state.pos[1] = py; state.pos[2] = pz;
  state.vel[0] = x3(state.vel); state.vel[1] = y3(state.vel); state.vel[2] = z3(state.vel);
  state.angVel[0] = x3(state.angVel);
  state.angVel[1] = y3(state.angVel);
  state.angVel[2] = z3(state.angVel);
  copyQuatSanitized(state.rot, state.rot);

  // 2) comandos: clamp [-1,1], non-finite => 0.
  const thrust = cmdAxis(cmd.thrust);
  const strafeX = cmdAxis(cmd.strafeX);
  const strafeY = cmdAxis(cmd.strafeY);
  const pitch = cmdAxis(cmd.pitch);
  const yaw = cmdAxis(cmd.yaw);
  const roll = cmdAxis(cmd.roll);
  const boost = cmd.boost === true;
  const thrustAccel = SHIP_CONFIG.THRUST_ACCEL * (boost ? SHIP_CONFIG.BOOST_MULTIPLIER : 1);

  // 3) aceleração linear no quadro local (frente da nave = -Z) -> mundo.
  SCRATCH_LOCAL_ACCEL[0] = strafeX * SHIP_CONFIG.STRAFE_ACCEL;
  SCRATCH_LOCAL_ACCEL[1] = strafeY * SHIP_CONFIG.STRAFE_ACCEL;
  SCRATCH_LOCAL_ACCEL[2] = -thrust * thrustAccel;
  vec3.transformQuat(SCRATCH_WORLD_ACCEL, SCRATCH_LOCAL_ACCEL, state.rot);

  // 4) aceleração angular no quadro do corpo (pitch=X, yaw=Y, roll=Z).
  SCRATCH_ANG_ACCEL[0] = pitch * SHIP_CONFIG.TURN_ACCEL_PITCH;
  SCRATCH_ANG_ACCEL[1] = yaw * SHIP_CONFIG.TURN_ACCEL_YAW;
  SCRATCH_ANG_ACCEL[2] = roll * SHIP_CONFIG.TURN_ACCEL_ROLL;

  // 5) fronteira: soma a mola no accel e amortece a velocidade radial.
  applyMagneticBoundary(state.pos, state.vel, SCRATCH_WORLD_ACCEL);

  // 6) integração in-place com damping exponencial.
  integrateLinearVelocity(state.vel, SCRATCH_WORLD_ACCEL, h, SHIP_CONFIG.LINEAR_DRAG, state.vel);
  integrateAngularVelocity(state.angVel, SCRATCH_ANG_ACCEL, h, SHIP_CONFIG.ANGULAR_DRAG, state.angVel);

  // 7) posição: p += v*dt.
  state.pos[0] = px + x3(state.vel) * h;
  state.pos[1] = py + y3(state.vel) * h;
  state.pos[2] = pz + z3(state.vel) * h;

  // 8) orientação: q' = q ⊗ Δq(ω*dt).
  integrateRotation(state.rot, state.angVel, h, state.rot);
}
