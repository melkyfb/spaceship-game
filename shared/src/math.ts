// Matemática vetorial/geométrica reutilizável e isomórfica (sem DOM/Three/Node).
// Nenhuma alocação de objetos em hot path: resultados de colisão usam `out`
// opcional (com um scratch de módulo documentado como fallback) e o SpatialHash
// reutiliza buckets via `length = 0` + dedup por geração (sem arrays temporários).

/** Tipos de posição aceitos (compatível com `vec3` do gl-matrix quando backed por Float32Array). */
export type Vec3 = Float32Array | [number, number, number];

/** Resultado de um teste de colisão contínua. Preencha um `out` próprio para reter o resultado. */
export interface HitResult {
  hit: boolean;
  /** Parâmetro de impacto no caminho percorrido, sempre em [0, 1] quando `hit`. */
  t: number;
  /** Normal de contato unitária (do centro da esfera para o ponto de contato). */
  nx: number;
  ny: number;
  nz: number;
}

// Scratch compartilhado: usado apenas quando o chamador não fornece `out`.
// ATENÇÃO: o objeto é sobrescrito a cada chamada; pass `out` para reter resultados.
const SCRATCH_HIT: HitResult = { hit: false, t: 0, nx: 0, ny: 0, nz: 0 };

/** Limita `value` ao intervalo [min, max]. Não normaliza NaN (use `isFiniteNumber`). */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Type guard contra NaN/Infinity e valores não-numéricos (ex.: eixos de comando corrompidos). */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Leitura segura de coordenada sob `noUncheckedIndexedAccess`. */
function coord(v: Vec3, index: 0 | 1 | 2): number {
  return v[index] ?? 0;
}

// Chave numérica sem colisões dentro da arena (±500u). Bias/stride mantêm a
// chave exata como inteiro JS (< 2^53) e evitam alocação de strings por query.
const KEY_BIAS = 512;
const KEY_STRIDE = 1024;

function cellKey(ix: number, iy: number, iz: number): number {
  return ((ix + KEY_BIAS) * KEY_STRIDE + (iy + KEY_BIAS)) * KEY_STRIDE + (iz + KEY_BIAS);
}

/**
 * Hash espacial 3D com células cúbicas (40u por padrão).
 *
 * `insert` registra o id em todas as células que a esfera (pos, radius) toca;
 * `query` varre a mesma faixa e devolve ids no array `out` (limpo a cada chamada).
 * `clear()` zera os buckets em vez de descartá-los, mantendo o pool entre ticks.
 * Resultados podem vir de células sobrepostas; dedup por geração evita duplicatas.
 */
export class SpatialHash3D {
  readonly cellSize: number;
  private readonly cells = new Map<number, number[]>();
  private generation = 0;
  private readonly lastSeen = new Map<number, number>();

  constructor(cellSize = 40) {
    this.cellSize = cellSize > 0 ? cellSize : 40;
  }

  /** Esvazia todos os buckets reutilizando os arrays já alocados (zero-alloc). */
  clear(): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
    }
  }

  /** Insere `id` em todas as células sobrepostas pela esfera (pos, radius). */
  insert(id: number, pos: Vec3, radius: number): void {
    const px = coord(pos, 0);
    const py = coord(pos, 1);
    const pz = coord(pos, 2);
    const cs = this.cellSize;
    const r = radius > 0 ? radius : 0;

    const minX = Math.floor((px - r) / cs);
    const maxX = Math.floor((px + r) / cs);
    const minY = Math.floor((py - r) / cs);
    const maxY = Math.floor((py + r) / cs);
    const minZ = Math.floor((pz - r) / cs);
    const maxZ = Math.floor((pz + r) / cs);

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        for (let iz = minZ; iz <= maxZ; iz++) {
          const key = cellKey(ix, iy, iz);
          let bucket = this.cells.get(key);
          if (bucket === undefined) {
            bucket = [];
            this.cells.set(key, bucket);
          }
          bucket.push(id);
        }
      }
    }
  }

  /**
   * Coleta ids nas células sobrepostas pela esfera de consulta.
   * Sempre limpa `out` (`out.length = 0`) e retorna o próprio `out`.
   */
  query(pos: Vec3, radius: number, out: number[]): number[] {
    out.length = 0;

    const px = coord(pos, 0);
    const py = coord(pos, 1);
    const pz = coord(pos, 2);
    const cs = this.cellSize;
    const r = radius > 0 ? radius : 0;

    const minX = Math.floor((px - r) / cs);
    const maxX = Math.floor((px + r) / cs);
    const minY = Math.floor((py - r) / cs);
    const maxY = Math.floor((py + r) / cs);
    const minZ = Math.floor((pz - r) / cs);
    const maxZ = Math.floor((pz + r) / cs);

    const gen = ++this.generation;
    const lastSeen = this.lastSeen;

    for (let ix = minX; ix <= maxX; ix++) {
      for (let iy = minY; iy <= maxY; iy++) {
        for (let iz = minZ; iz <= maxZ; iz++) {
          const bucket = this.cells.get(cellKey(ix, iy, iz));
          if (bucket === undefined) continue;
          for (let i = 0; i < bucket.length; i++) {
            const id = bucket[i] as number;
            if (lastSeen.get(id) === gen) continue;
            lastSeen.set(id, gen);
            out.push(id);
          }
        }
      }
    }
    return out;
  }
}

/**
 * Colisão contínua de segmento contra esfera (projétil vs asteroide).
 *
 * Resolve o ponto mais próximo de C no segmento A->B (t clampado em [0,1]) e
 * verifica se a distância até C cabe no raio. Detecta tunelamento mesmo quando
 * ambas as extremidades estão fora da esfera. `t` é o parâmetro de maior
 * penetração — adequado para posicionar o evento de impacto.
 */
export function sweptSegmentSphere(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  r: number,
  out: HitResult = SCRATCH_HIT,
): HitResult {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const lenSq = dx * dx + dy * dy + dz * dz;

  let t: number;
  if (lenSq <= 1e-12) {
    t = 0; // segmento degenerado: testa apenas o ponto inicial
  } else {
    t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const ox = ax + t * dx - cx;
  const oy = ay + t * dy - cy;
  const oz = az + t * dz - cz;
  const distSq = ox * ox + oy * oy + oz * oz;
  const radius = r > 0 ? r : 0;
  out.t = t;

  if (distSq > radius * radius) {
    out.hit = false;
    out.nx = 0;
    out.ny = 0;
    out.nz = 0;
    return out;
  }

  out.hit = true;
  const dist = Math.sqrt(distSq);
  if (dist > 1e-9) {
    out.nx = ox / dist;
    out.ny = oy / dist;
    out.nz = oz / dist;
  } else {
    // Centro exatamente sobre o caminho: normal estável apontando contra o movimento.
    const len = Math.sqrt(lenSq);
    if (len > 1e-9) {
      out.nx = -dx / len;
      out.ny = -dy / len;
      out.nz = -dz / len;
    } else {
      out.nx = 1;
      out.ny = 0;
      out.nz = 0;
    }
  }
  return out;
}

/**
 * Colisão contínua de esfera contra esfera (nave vs asteroide).
 *
 * Reduz a movimento relativo: a esfera 1 percorre, em `dt`, o segmento
 * P1 -> P1 + (V1 - V2) * dt contra uma esfera estacionária em P2 com raio
 * combinado `r` (= r nave + r asteroide). Velocidades em u/s, `dt` em segundos
 * (padrão = FIXED_DT = 1/30, do spec).
 */
export function sweptSphereSphere(
  p1x: number, p1y: number, p1z: number,
  v1x: number, v1y: number, v1z: number,
  p2x: number, p2y: number, p2z: number,
  v2x: number, v2y: number, v2z: number,
  r: number,
  dt = 1 / 30,
  out: HitResult = SCRATCH_HIT,
): HitResult {
  const dx = (v1x - v2x) * dt;
  const dy = (v1y - v2y) * dt;
  const dz = (v1z - v2z) * dt;
  return sweptSegmentSphere(p1x, p1y, p1z, p1x + dx, p1y + dy, p1z + dz, p2x, p2y, p2z, r, out);
}
