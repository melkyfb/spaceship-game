/** Minimal shape of `window.location` needed to derive the WS endpoint. */
export interface LocationLike {
  protocol: string
  host: string
}

/**
 * Build the same-origin WebSocket URL used by the dev proxy.
 *
 * HTTPS pages must use `wss://` (otherwise the browser blocks a mixed-content
 * connection); plain HTTP pages use `ws://`.
 */
export function buildWsUrl(locationLike: LocationLike): string {
  const scheme = locationLike.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${locationLike.host}/ws`
}
