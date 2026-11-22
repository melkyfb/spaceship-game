import { describe, expect, it } from 'vitest'
import { buildWsUrl } from '../src/ws-status'

describe('buildWsUrl', () => {
  it('uses wss for https pages', () => {
    expect(buildWsUrl({ protocol: 'https:', host: '192.168.0.10:5173' })).toBe('wss://192.168.0.10:5173/ws')
  })

  it('uses ws for http pages', () => {
    expect(buildWsUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe('ws://localhost:5173/ws')
  })
})
