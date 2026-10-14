import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { vi, type Mock } from 'vitest'
import { WebSocketServer, type WebSocket } from 'ws'

/** Anything the fake OneBot implementation sends or receives. */
export type Frame = Record<string, any>

/**
 * A tiny OneBot 11 flavoured WebSocket endpoint on an ephemeral loopback port.
 *
 * It records the request URL of every accepted connection (so tests can assert
 * the `access_token` query handling) and every JSON frame it receives, and lets
 * each test script replies through {@link onConnection} / {@link onFrame}.
 */
export class TestServer {
  readonly wss: WebSocketServer
  /** `request.url` of every accepted connection, in order. */
  readonly requestUrls: string[] = []
  /** Every JSON frame the server received, in order. */
  readonly frames: Frame[] = []
  readonly sockets: WebSocket[] = []
  /** Invoked for each new socket, before any frame arrives. */
  onConnection?: (socket: WebSocket, server: TestServer) => void
  /** Invoked for every parsed frame. */
  onFrame?: (frame: Frame, socket: WebSocket, server: TestServer) => void

  private constructor(wss: WebSocketServer) {
    this.wss = wss
  }

  static async start(options: { port?: number; rejectHandshakes?: number } = {}): Promise<TestServer> {
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: options.port ?? 0,
      // Rejecting the upgrade keeps a "the implementation refused us" scenario
      // deterministic: the client never reaches `open`.
      verifyClient: options.rejectHandshakes
        ? (_info, callback) => callback(false, options.rejectHandshakes, 'rejected by test server')
        : undefined,
    })
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', () => resolve())
      wss.once('error', reject)
    })

    const server = new TestServer(wss)
    wss.on('connection', (socket, request) => {
      server.requestUrls.push(request.url ?? '')
      server.sockets.push(socket)
      socket.on('message', (raw) => {
        const frame = JSON.parse(raw.toString()) as Frame
        server.frames.push(frame)
        server.onFrame?.(frame, socket, server)
      })
      server.onConnection?.(socket, server)
    })
    return server
  }

  get port(): number {
    return (this.wss.address() as AddressInfo).port
  }

  get url(): string {
    return `ws://127.0.0.1:${this.port}`
  }

  get socket(): WebSocket | undefined {
    return this.sockets.at(-1)
  }

  get lastFrame(): Frame | undefined {
    return this.frames.at(-1)
  }

  get connectionCount(): number {
    return this.sockets.length
  }

  /** Answer an action call the way a OneBot implementation does. */
  reply(echo: string, response: Frame, socket = this.socket): void {
    socket?.send(JSON.stringify({ ...response, echo }))
  }

  /** Answer every action call so far with a retcode 0 envelope. */
  replyOk(data: unknown = {}, socket = this.socket): void {
    for (const frame of this.frames) {
      this.reply(frame.echo, { status: 'ok', retcode: 0, data, message: '' }, socket)
    }
  }

  send(frame: Frame, socket = this.socket): void {
    socket?.send(JSON.stringify(frame))
  }

  sendRaw(data: string, socket = this.socket): void {
    socket?.send(data)
  }

  /** Wait until at least `count` connections have been accepted. */
  async waitForConnections(count: number, timeoutMs = 5_000): Promise<WebSocket[]> {
    return this.#waitFor(() => (this.sockets.length >= count ? this.sockets : undefined), `>= ${count} connections`, timeoutMs)
  }

  /** Wait for the next frame matching `predicate`. */
  async waitForFrame(predicate: (frame: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    return this.#waitFor(() => this.frames.find(predicate), 'matching frame', timeoutMs)
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.terminate()
    if (this.wss.clients.size > 0) {
      for (const client of this.wss.clients) client.terminate()
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()))
  }

  async #waitFor<T>(probe: () => T | undefined, what: string, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = probe()
      if (value !== undefined) return value
      if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
      await delay(5)
    }
  }
}

/** The logger shape the library accepts, as a spy per method. */
type LogFn = (...args: unknown[]) => void

export interface MockLogger {
  info: Mock<LogFn>
  warn: Mock<LogFn>
  debug: Mock<LogFn>
  error: Mock<LogFn>
}

/** A logger that records everything and prints nothing. */
export function createMockLogger(): MockLogger {
  return {
    info: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    debug: vi.fn<LogFn>(),
    error: vi.fn<LogFn>(),
  }
}

/** Logger for tests that assert on something else entirely. */
export const silentLogger = createMockLogger()

/** Ask the OS for a port that is free right now, then give it back. */
export async function findClosedPort(): Promise<number> {
  const server = await TestServer.start()
  const { port } = server
  await server.close()
  return port
}
