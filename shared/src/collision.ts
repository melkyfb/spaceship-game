// Colisão contínua integrada ao fluxo de simulação (US-04 / conclusão M1).
// Isomórfico: sem DOM/Three/Node/fs/crypto. Zero-alloc: o hash, o array de
// candidatos, o HitResult e o centro de consulta são pré-alocados no escopo do
// módulo; eventos são escritos num pool fixo com contador (sem `new`/`push` de
// objetos novos por tick). O chamador controla o reset do buffer: os resolvers
// apenas acrescentam eventos, para que projéteis e naves possam ser resolvidos
// no mesmo tick sem se sobrescreverem.
import { ASTEROID_TIERS, SHIP_CONFIG } from './constants';
import { isFiniteNumber, SpatialHash3D, sweptSegmentSphere, sweptSphereSphere } from './math';
import type { HitResult } from './math';
import { FIXED_DT } from './physics';
import type { AsteroidState, ProjectileState, ShipState } from './types';

/** Rebote elástico parcial (spec 4.2). */
const RESTITUTION = 0.6;
/** Dano de nave vs asteroide: max(5, 0.45 * vrel) (spec 4.2). */
const DAMAGE_FLOOR = 5;
const DAMAGE_SCALE = 0.45;

/**
 * Raio efetivo do projétil no raio combinado `R_alvo + R_projétil` da spec 4.2.
 * NÃO há constante no spec para ele; 0.2 é inferido (padding usado nos testes
 * de swept da Task 3: SMALL 3 + 0.2 = 3.2). Mantido exportado/visível até o
 * spec/F2 definir o valor oficial.
 */
export const PROJECTILE_RADIUS = 0.2;
/** Folga conservadora na broadphase para bordas de célula (a narrowphase é exata). */
const QUERY_MARGIN = 1;

const SHIP_MASS = SHIP_CONFIG.RADIUS ** 3;

/** Escudo corrompido (NaN/Infinity) não deve contaminar o dano. */
function finiteOrZero(x: number): number {
  return isFiniteNumber(x) ? x : 0;
}

// Scratch de módulo — criados uma única vez, nunca por tick.
const HASH = new SpatialHash3D();
const HIT: HitResult = { hit: false, t: 0, nx: 0, ny: 0, nz: 0 };
const CANDIDATES: number[] = [];
const SCRATCH_CENTER: [number, number, number] = [0, 0, 0];

export type CollisionEventKind = 'PROJECTILE_ASTEROID' | 'SHIP_ASTEROID';

/**
 * Evento de impacto. `aId` é `projectile.id` (number) para PROJECTILE_ASTEROID
 * e `ship.id` (string) para SHIP_ASTEROID; `bId` é sempre `asteroid.id`.
 * `x/y/z` é o ponto de impacto no mundo (útil para partículas/HUD).
 */
export interface CollisionEvent {
  kind: CollisionEventKind;
  aId: number | string;
  bId: number;
  /** Parâmetro de impacto no caminho varredo, em [0, 1]. */
  t: number;
  /** Dano aplicado; 0 para projéteis (dano de tiro é da lógica de jogo, F2). */
  damage: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Pool fixo de eventos: struct-of-objects pré-alocado uma vez no construtor.
 * `push` sobrescreve o objeto no slot `count` — nenhuma alocação no hot path.
 * Eventos acima da capacidade são descartados em vez de realocar o pool.
 * `reset()` zera só o contador; os objetos permanecem os mesmos entre ticks.
 */
export class CollisionEventBuffer {
  readonly capacity: number;
  count = 0;
  private readonly pool: CollisionEvent[] = [];

  constructor(capacity = 256) {
    const n = isFiniteNumber(capacity) && capacity > 0 ? Math.floor(capacity) : 256;
    this.capacity = n;
    for (let i = 0; i < n; i++) {
      this.pool.push({
        kind: 'PROJECTILE_ASTEROID', aId: 0, bId: 0, t: 0, damage: 0, x: 0, y: 0, z: 0,
      });
    }
  }

  reset(): void {
    this.count = 0;
  }

  /** Só devolve eventos válidos (índice < count). */
  get(index: number): CollisionEvent | undefined {
    return index >= 0 && index < this.count ? this.pool[index] : undefined;
  }

  push(
    kind: CollisionEventKind,
    aId: number | string,
    bId: number,
    t: number,
    damage: number,
    x: number,
    y: number,
    z: number,
  ): void {
    if (this.count >= this.capacity) return;
    const e = this.pool[this.count] as CollisionEvent;
    e.kind = kind;
    e.aId = aId;
    e.bId = bId;
    e.t = t;
    e.damage = damage;
    e.x = x;
    e.y = y;
    e.z = z;
    this.count++;
  }
}

/** Raio do asteroide pelo tier (ASTEROID_TIERS é `as const`, chave garantida). */
function asteroidRadius(a: AsteroidState): number {
  return ASTEROID_TIERS[a.size].radius;
}

/**
 * Reconstrói o hash por tick: `clear()` reutiliza os buckets e insere o ÍNDICE
 * do asteroide no array (não `asteroid.id`), evitando um Map id->objeto por
 * tick. `padding` já inclui o raio do agente testado, então a broadphase só
 * precisa cobrir o comprimento do caminho varredo.
 */
function rebuildAsteroidHash(asteroids: readonly AsteroidState[], padding: number): void {
  HASH.clear();
  for (let i = 0; i < asteroids.length; i++) {
    const a = asteroids[i];
    if (a === undefined) continue;
    HASH.insert(i, a.pos, asteroidRadius(a) + padding);
  }
}

/**
 * Detecta impactos de projéteis contra asteroide usando o segmento
 * `prevPos -> pos` (swept segment-to-sphere) — elimina tunelamento de lasers a
 * 240 u/s. Emite um evento por par projétil/asteroide que cruza o raio
 * efetivo.
 *
 * Contrato: o resolver só detecta e emite eventos (`damage` é 0; dano de tiro é
 * da lógica de jogo, F2). Ele NÃO consome/muta projéteis — o chamador deve
 * remover/consumir o projétil ao processar o evento. Projéteis com `ttl <= 0`
 * ou coordenadas não finitas são ignorados; asteroides com coordenadas não
 * finitas são ignorados na narrowphase.
 */
export function resolveProjectileAsteroidCollisions(
  projectiles: readonly ProjectileState[],
  asteroids: readonly AsteroidState[],
  outEvents: CollisionEventBuffer,
): void {
  if (projectiles.length === 0 || asteroids.length === 0) return;
  rebuildAsteroidHash(asteroids, PROJECTILE_RADIUS);

  for (let i = 0; i < projectiles.length; i++) {
    const p = projectiles[i];
    if (p === undefined) continue;
    if (!isFiniteNumber(p.ttl) || p.ttl <= 0) continue;
    // Only player-owned projectiles damage asteroids (enemy plasma/missiles do not).
    const isPlayerProjectile = p.kind === 'LASER' || (p.kind === 'MISSILE' && !p.ownerId.startsWith('enemy:'));
    if (!isPlayerProjectile) continue;

    const ax = p.prevPos[0] ?? 0;
    const ay = p.prevPos[1] ?? 0;
    const az = p.prevPos[2] ?? 0;
    const bx = p.pos[0] ?? 0;
    const by = p.pos[1] ?? 0;
    const bz = p.pos[2] ?? 0;
    if (
      !isFiniteNumber(ax) || !isFiniteNumber(ay) || !isFiniteNumber(az) ||
      !isFiniteNumber(bx) || !isFiniteNumber(by) || !isFiniteNumber(bz)
    ) continue;

    SCRATCH_CENTER[0] = (ax + bx) * 0.5;
    SCRATCH_CENTER[1] = (ay + by) * 0.5;
    SCRATCH_CENTER[2] = (az + bz) * 0.5;
    const queryRadius = Math.hypot(bx - ax, by - ay, bz - az) * 0.5 + QUERY_MARGIN;
    HASH.query(SCRATCH_CENTER, queryRadius, CANDIDATES);

    for (let c = 0; c < CANDIDATES.length; c++) {
      const idx = CANDIDATES[c] as number;
      const a = asteroids[idx];
      if (a === undefined) continue;

      const r = asteroidRadius(a) + PROJECTILE_RADIUS;
      sweptSegmentSphere(
        ax, ay, az, bx, by, bz,
        a.pos[0] ?? 0, a.pos[1] ?? 0, a.pos[2] ?? 0,
        r, HIT,
      );
      if (!HIT.hit) continue;

      const t = HIT.t;
      outEvents.push(
        'PROJECTILE_ASTEROID', p.id, a.id, t, 0,
        ax + t * (bx - ax),
        ay + t * (by - ay),
        az + t * (bz - az),
      );
    }
  }
}

/**
 * Resolve nave vs asteroide com swept sphere-to-sphere (movimento relativo),
 * dano `max(5, 0.45*vrel)` no escudo e rebote elástico parcial `e = 0.6` com
 * massas `M ∝ R³` (a constante de proporcionalidade cancela no impulso).
 *
 * Contrato de tick: o resolver opera sobre o estado no início do tick fixo
 * (FIXED_DT) e emite eventos com `t` em [0,1] relativo ao tick. Ele muta
 * `ship.vel`, `ship.shield` e `asteroid.vel`, mas NÃO integra `ship.pos` —
 * o chamador deve integrar posição/reconciliação no passo de física do tick.
 * Para múltiplos candidatos, escolhe o impacto mais cedo (menor `t`), aplica
 * o rebote, avança a origem do sweep até o contato + pequena separação e
 * repete com o tempo restante. Isso reduz penetração residual e dependência
 * de ordem do hash. Estados com coordenadas/velocidades não finitas são
 * ignorados.
 */
export function resolveShipAsteroidCollisions(
  ships: readonly ShipState[],
  asteroids: readonly AsteroidState[],
  outEvents: CollisionEventBuffer,
): void {
  if (ships.length === 0 || asteroids.length === 0) return;
  rebuildAsteroidHash(asteroids, SHIP_CONFIG.RADIUS);

  for (let i = 0; i < ships.length; i++) {
    const s = ships[i];
    if (s === undefined || s.alive === false) continue;

    const p0x = s.pos[0] ?? 0;
    const p0y = s.pos[1] ?? 0;
    const p0z = s.pos[2] ?? 0;
    let vx = s.vel[0] ?? 0;
    let vy = s.vel[1] ?? 0;
    let vz = s.vel[2] ?? 0;
    if (
      !isFiniteNumber(p0x) || !isFiniteNumber(p0y) || !isFiniteNumber(p0z) ||
      !isFiniteNumber(vx) || !isFiniteNumber(vy) || !isFiniteNumber(vz)
    ) continue;

    let px = p0x;
    let py = p0y;
    let pz = p0z;
    let dtRemaining = FIXED_DT;
    let elapsed = 0;

    // Query ampla o bastante para o caminho completo do tick.
    const fullDx = vx * FIXED_DT;
    const fullDy = vy * FIXED_DT;
    const fullDz = vz * FIXED_DT;
    SCRATCH_CENTER[0] = p0x + fullDx * 0.5;
    SCRATCH_CENTER[1] = p0y + fullDy * 0.5;
    SCRATCH_CENTER[2] = p0z + fullDz * 0.5;
    const queryRadius = Math.hypot(fullDx, fullDy, fullDz) * 0.5 + SHIP_CONFIG.RADIUS + QUERY_MARGIN;
    HASH.query(SCRATCH_CENTER, queryRadius, CANDIDATES);

    for (let iter = 0; iter < CANDIDATES.length && dtRemaining > 1e-9; iter++) {
      let bestIdx = -1;
      let bestT = 2;
      let bestNx = 0;
      let bestNy = 0;
      let bestNz = 0;

      for (let c = 0; c < CANDIDATES.length; c++) {
        const idx = CANDIDATES[c] as number;
        const a = asteroids[idx];
        if (a === undefined) continue;

        const ax = a.pos[0] ?? 0;
        const ay = a.pos[1] ?? 0;
        const az = a.pos[2] ?? 0;
        const avx = a.vel[0] ?? 0;
        const avy = a.vel[1] ?? 0;
        const avz = a.vel[2] ?? 0;
        if (
          !isFiniteNumber(ax) || !isFiniteNumber(ay) || !isFiniteNumber(az) ||
          !isFiniteNumber(avx) || !isFiniteNumber(avy) || !isFiniteNumber(avz)
        ) continue;

        const r = SHIP_CONFIG.RADIUS + asteroidRadius(a);
        sweptSphereSphere(px, py, pz, vx, vy, vz, ax, ay, az, avx, avy, avz, r, dtRemaining, HIT);
        if (!HIT.hit) continue;
        if (HIT.t < bestT) {
          bestT = HIT.t;
          bestIdx = idx;
          bestNx = HIT.nx;
          bestNy = HIT.ny;
          bestNz = HIT.nz;
        }
      }

      if (bestIdx < 0) break;
      const a = asteroids[bestIdx];
      if (a === undefined) break;

      const ax = a.pos[0] ?? 0;
      const ay = a.pos[1] ?? 0;
      const az = a.pos[2] ?? 0;
      const avx = a.vel[0] ?? 0;
      const avy = a.vel[1] ?? 0;
      const avz = a.vel[2] ?? 0;

      const vxBefore = vx;
      const vyBefore = vy;
      const vzBefore = vz;
      const adv = bestT * dtRemaining;
      const impactX = px + vxBefore * adv;
      const impactY = py + vyBefore * adv;
      const impactZ = pz + vzBefore * adv;
      const sep = 1e-4;

      // t~0 no sub-sweep: sobreposição residual já tratada; separa e avança
      // sem aplicar dano/rebote duplicado.
      if (adv < 1e-8) {
        const step = Math.min(1e-5, dtRemaining);
        px = impactX + bestNx * sep + vx * step;
        py = impactY + bestNy * sep + vy * step;
        pz = impactZ + bestNz * sep + vz * step;
        elapsed += step;
        dtRemaining -= step;
        if (dtRemaining < 0) dtRemaining = 0;
        continue;
      }

      const rvx = vxBefore - avx;
      const rvy = vyBefore - avy;
      const rvz = vzBefore - avz;
      const vrel = Math.hypot(rvx, rvy, rvz);
      const damage = Math.max(DAMAGE_FLOOR, DAMAGE_SCALE * vrel);
      s.shield = Math.max(0, finiteOrZero(s.shield) - damage);

      const vn = rvx * bestNx + rvy * bestNy + rvz * bestNz;
      if (vn < 0) {
        const m2 = asteroidRadius(a) ** 3;
        const invMassSum = 1 / SHIP_MASS + 1 / m2;
        const j = -(1 + RESTITUTION) * vn / invMassSum;
        const jShip = j / SHIP_MASS;
        const jAst = j / m2;

        vx += jShip * bestNx;
        vy += jShip * bestNy;
        vz += jShip * bestNz;
        s.vel[0] = vx;
        s.vel[1] = vy;
        s.vel[2] = vz;

        a.vel[0] = avx - jAst * bestNx;
        a.vel[1] = avy - jAst * bestNy;
        a.vel[2] = avz - jAst * bestNz;
      }

      const hitT = elapsed / FIXED_DT + adv / FIXED_DT;
      outEvents.push(
        'SHIP_ASTEROID', s.id, a.id, hitT, damage,
        impactX, impactY, impactZ,
      );

      px = impactX + bestNx * sep;
      py = impactY + bestNy * sep;
      pz = impactZ + bestNz * sep;
      elapsed += adv;
      dtRemaining -= adv;
      if (dtRemaining < 0) dtRemaining = 0;
    }
  }
}

