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
 * Não há constante no spec para ele; 0.2 é o padding já usado nos testes de
 * swept da Task 3 (SMALL: 3 + 0.2 = 3.2).
 */
const PROJECTILE_RADIUS = 0.2;
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
 * efetivo. Não destrói o projétil nem aplica dano: isso pertence à lógica de
 * jogo (F2); o `damage` do evento é 0 por definição nesta resolução.
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

    const ax = p.prevPos[0] ?? 0;
    const ay = p.prevPos[1] ?? 0;
    const az = p.prevPos[2] ?? 0;
    const bx = p.pos[0] ?? 0;
    const by = p.pos[1] ?? 0;
    const bz = p.pos[2] ?? 0;

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
 * Velocidades locais são reutilizadas a cada candidato para que colisões
 * múltiplas no mesmo tick sejam aplicadas sequencialmente.
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
    if (s === undefined) continue;

    const px = s.pos[0] ?? 0;
    const py = s.pos[1] ?? 0;
    const pz = s.pos[2] ?? 0;
    let vx = s.vel[0] ?? 0;
    let vy = s.vel[1] ?? 0;
    let vz = s.vel[2] ?? 0;

    const dx = vx * FIXED_DT;
    const dy = vy * FIXED_DT;
    const dz = vz * FIXED_DT;
    SCRATCH_CENTER[0] = px + dx * 0.5;
    SCRATCH_CENTER[1] = py + dy * 0.5;
    SCRATCH_CENTER[2] = pz + dz * 0.5;
    const queryRadius = Math.hypot(dx, dy, dz) * 0.5 + QUERY_MARGIN;
    HASH.query(SCRATCH_CENTER, queryRadius, CANDIDATES);

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
      const r = SHIP_CONFIG.RADIUS + asteroidRadius(a);

      sweptSphereSphere(px, py, pz, vx, vy, vz, ax, ay, az, avx, avy, avz, r, FIXED_DT, HIT);
      if (!HIT.hit) continue;

      // Velocidade relativa nave - asteroide (antes do impacto).
      const vxBefore = vx;
      const vyBefore = vy;
      const vzBefore = vz;
      const rvx = vxBefore - avx;
      const rvy = vyBefore - avy;
      const rvz = vzBefore - avz;
      const vrel = Math.hypot(rvx, rvy, rvz);
      const damage = Math.max(DAMAGE_FLOOR, DAMAGE_SCALE * vrel);
      s.shield = Math.max(0, finiteOrZero(s.shield) - damage);

      // A normal aponta do asteroide para a nave; vn < 0 = aproximação.
      const nx = HIT.nx;
      const ny = HIT.ny;
      const nz = HIT.nz;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn < 0) {
        const m2 = asteroidRadius(a) ** 3;
        const invMassSum = 1 / SHIP_MASS + 1 / m2;
        const j = -(1 + RESTITUTION) * vn / invMassSum;
        const jShip = j / SHIP_MASS;
        const jAst = j / m2;

        vx += jShip * nx;
        vy += jShip * ny;
        vz += jShip * nz;
        s.vel[0] = vx;
        s.vel[1] = vy;
        s.vel[2] = vz;

        a.vel[0] = avx - jAst * nx;
        a.vel[1] = avy - jAst * ny;
        a.vel[2] = avz - jAst * nz;
      }

      const t = HIT.t;
      outEvents.push(
        'SHIP_ASTEROID', s.id, a.id, t, damage,
        px + vxBefore * FIXED_DT * t,
        py + vyBefore * FIXED_DT * t,
        pz + vzBefore * FIXED_DT * t,
      );
    }
  }
}

