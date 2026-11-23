import { describe, expect, it } from 'vitest'
import { ClockSync } from '../../src/net/ClockSync'

describe('ClockSync', () => {
  it('computes server offset from PING/PONG and exposes serverNow', () => {
    let now = 1000
    const clock = new ClockSync(() => now)

    // Client sent PING at clientTime=1000, server answered serverTime=5000, received at 1100.
    clock.handlePong(1000, 5000, 1100)

    // rtt=100, estimated one-way=50, offset = 5000 - (1000+50) = 3950
    now = 1100
    expect(clock.serverNow()).toBe(5050)

    now = 1200
    expect(clock.serverNow()).toBe(5150)
  })

  it('uses current now() as receive time when receiveTime is omitted', () => {
    let now = 200
    const clock = new ClockSync(() => now)

    now = 260
    clock.handlePong(200, 9000)

    // rtt=60, one-way=30, offset = 9000 - 230 = 8770
    expect(clock.serverNow()).toBe(9030)
  })

  it('keeps the lowest-rtt sample as the best offset estimate', () => {
    let now = 0
    const clock = new ClockSync(() => now)

    // High RTT sample.
    now = 500
    clock.handlePong(0, 1000, 500) // rtt 500, offset 750
    expect(clock.serverNow()).toBe(1250)

    // Lower RTT sample should replace it.
    now = 700
    clock.handlePong(600, 1500, 700) // rtt 100, offset 850
    expect(clock.serverNow()).toBe(1550)

    // Higher RTT sample should not replace a better estimate.
    now = 1400
    clock.handlePong(800, 2100, 1400) // rtt 600, offset 1000, worse
    expect(clock.serverNow()).toBe(2250)
  })
})
