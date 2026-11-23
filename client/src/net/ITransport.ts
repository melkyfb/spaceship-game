import type { ClientMessage, ServerMessage } from '@asteroids/shared'

export interface ITransport {
  connect(): Promise<void>
  send(msg: ClientMessage): void
  onMessage(cb: (msg: ServerMessage) => void): () => void
  close(): void
}
