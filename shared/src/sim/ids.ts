// Gerador determinístico/monotônico de IDs para entidades de sim.
// Instância por sala/simulação; sem estado global.
export class IdSeq {
  private current: number

  constructor(start = 1) {
    // Garante inteiro finito; fallback determinístico para entrada inválida.
    this.current = Number.isFinite(start) ? Math.trunc(start) : 1
  }

  next(): number {
    const id = this.current
    this.current += 1
    return id
  }
}
