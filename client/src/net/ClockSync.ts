/**
 * Computes client↔server clock offset from PING/PONG samples and exposes an
 * estimated server clock. Uses the lowest-RTT sample as the best estimate.
 */
export class ClockSync {
  private readonly now: () => number
  private offset = 0
  private bestRtt = Number.POSITIVE_INFINITY
  private hasSample = false

  constructor(now: () => number = () => performance.now()) {
    this.now = now
  }

  /**
   * Process a PONG sample.
   * @param clientTime - client timestamp echoed back by the server (same clock as now()).
   * @param serverTime - server timestamp when PONG was produced.
   * @param receiveTime - client timestamp when PONG was received; defaults to now().
   */
  handlePong(clientTime: number, serverTime: number, receiveTime: number = this.now()): void {
    if (
      !Number.isFinite(clientTime) ||
      !Number.isFinite(serverTime) ||
      !Number.isFinite(receiveTime)
    ) {
      return
    }

    const rtt = receiveTime - clientTime
    if (rtt < 0) return

    const oneWay = rtt / 2
    const sampleOffset = serverTime - (clientTime + oneWay)

    if (!this.hasSample || rtt <= this.bestRtt) {
      this.bestRtt = rtt
      this.offset = sampleOffset
      this.hasSample = true
    }
  }

  /** Estimated current server time, in the same units as PONG serverTime. */
  serverNow(): number {
    return this.now() + this.offset
  }

  /** Current offset (serverTime - clientTimeEstimate). 0 before first sample. */
  getOffset(): number {
    return this.offset
  }

  /** RTT of the best sample, or Infinity before first sample. */
  getRtt(): number {
    return this.bestRtt
  }
}
