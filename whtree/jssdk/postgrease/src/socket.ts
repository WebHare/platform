import * as net from 'net';
import * as path from 'path';
import * as tls from 'tls';
import { RequestBuilder } from './request-builder';
import type { UndocumentedBuffer } from './types/node-types';
//import { getCodeName } from './types/protocol-codes';

export type SocketConnectionOptions = {
  /// Connection host (or socket directory for unix sockets)
  host: string;
  /// Connection port (also needed when using unix sockets)
  port: number;
  /// Whether to enable TCP keepalive
  keepAlive?: boolean;
  /// Connection timeout in milliseconds
  timeoutMs?: number;
};

export type SocketResponse = InstanceType<typeof PGPacketSocket>["curPacket"];

type DefaultPostgreSQLPort = 5432;

/** Connects to a PostgreSQL server over a socket, and provides methods to read and write packets.
 * Use curPacket to access the last read packet.
 */
export class PGPacketSocket {
  /// Scratch buffer for assembling packets that need an await
  private scratchBuffer = Buffer.allocUnsafe(16384) as UndocumentedBuffer;
  /// DataView for scratch buffer
  private scratchDataView = new DataView(this.scratchBuffer.buffer, this.scratchBuffer.byteOffset, this.scratchBuffer.byteLength);

  /// Underlying network socket
  private orgSocket: net.Socket;
  private socket: net.Socket | tls.TLSSocket;

  /// Current read buffer
  private buffer: UndocumentedBuffer;
  /// Current read buffer index
  private dataView: DataView;
  private bufferIdx = 0;
  private bufferEnd = 0;

  private closed = false;

  private requestBuilder = new RequestBuilder();

  private wait: PromiseWithResolvers<void> = Promise.withResolvers();

  curPacket: { buffer: UndocumentedBuffer; dataview: DataView; code: number; dataStart: number; dataLen: number } = { buffer: this.scratchBuffer, dataview: this.scratchDataView, code: 0, dataStart: 0, dataLen: 0 };

  constructor(socket: net.Socket) {
    this.orgSocket = socket;
    this.socket = socket;
    this.buffer = Buffer.from("") as UndocumentedBuffer;
    this.dataView = new DataView(this.buffer.buffer, this.buffer.byteOffset, 0);

    this.socket.addListener("readable", () => this.wait?.resolve());
    this.socket.addListener("close", () => {
      this.closed = true;
      // ensure that rejecting wait doesn't cause unhandled rejection
      this.wait.promise.catch(() => 0);
      this.wait.reject(new Error("PostgreSQL socket closed"));
    });
    this.socket.addListener("error", (err) => {
      // ensure that rejecting wait doesn't cause unhandled rejection
      this.wait.promise.catch(() => 0);
      this.wait?.reject(err);
    });
  }

  /** Ensures the next buffer is available for reading. Only called when the current buffer is exhausted. Returns null
   *  if a packet is immediately available, or a promise that resolves when data is available.
   */
  private readBuffer() {
    const buf = this.socket.read() as UndocumentedBuffer | null;
    if (buf?.length) {
      // not updating the dataview, it will be updated when the packet in the scratchbuffer is complete
      this.buffer = buf;
      this.bufferIdx = 0;
      this.bufferEnd = buf.length;
      return null;
    }
    return this.asyncReadBuffer();
  }

  private async asyncReadBuffer() {
    while (true) {
      this.wait = Promise.withResolvers<void>();
      await this.wait?.promise;

      if (this.closed)
        throw new Error("PostgreSQL socket closed");
      const buf = this.socket.read() as UndocumentedBuffer | null;
      if (buf?.length) {
        // not updating the dataview, it will be updated when the packet in the scratchbuffer is complete
        this.buffer = buf;
        this.bufferIdx = 0;
        this.bufferEnd = buf.length;
        return;
      }
    }
  }

  /** Read the rest of a packet asynchronously
   * @param gotLen - Number of bytes already read into the scratch buffer
   */
  private async readPacketAsync(gotLen: number): Promise<void> {
    while (true) {
      const wantLen = (gotLen < 5) ? 5 : 1 + this.scratchDataView.getUint32(1);
      if (gotLen === wantLen)
        break;

      // Get a new buffer if needed. Schedule it so scratch buffer resize can happen while waiting
      let readPromise: Promise<void> | null = null;
      if (this.bufferEnd === this.bufferIdx)
        readPromise = this.readBuffer();

      // Ensure the scratch buffer is large enough
      if (this.scratchBuffer.length < wantLen) {
        const newBuffer = Buffer.allocUnsafe(wantLen + 16384) as UndocumentedBuffer;
        this.scratchBuffer.copy(newBuffer, 0, 0, gotLen);
        this.scratchBuffer = newBuffer;
        this.scratchDataView = new DataView(this.scratchBuffer.buffer, this.scratchBuffer.byteOffset, this.scratchBuffer.byteLength);
      }

      // Wait for the new buffer
      if (readPromise)
        await readPromise;

      const toCopy = Math.min(this.bufferEnd - this.bufferIdx, wantLen - gotLen);
      this.buffer.copy(this.scratchBuffer, gotLen, this.bufferIdx, this.bufferIdx + toCopy);
      this.bufferIdx += toCopy;
      gotLen += toCopy;
    }

    // Enough data available in the scratch buffer. Make sure curPacket points to it
    if (this.curPacket.buffer !== this.scratchBuffer) {
      this.curPacket.buffer = this.scratchBuffer;
      this.curPacket.dataview = this.scratchDataView;
    }
    this.curPacket.code = this.scratchBuffer[0];
    this.curPacket.dataStart = 5;
    this.curPacket.dataLen = gotLen - 5;
    // Ensure the dataview of the receive buffer views that buffer
    this.dataView = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    //console.log(`readPacket: code: ${String.fromCharCode(this.curPacket.code)}: ${getCodeName(this.curPacket.code, true)} (waited)`);
  }

  /** Switches the current connection to use TLS with the given options. */
  async switchToTLS(tlsOptions: tls.ConnectionOptions) {
    this.wait = Promise.withResolvers<void>();

    this.socket.removeAllListeners("readable");
    this.socket.removeAllListeners("error");
    this.socket.removeAllListeners("close");

    const tlsSocket = tls.connect({ ...tlsOptions, socket: this.orgSocket });
    tlsSocket.once('error', this.wait.reject);
    tlsSocket.once('secureConnect', this.wait.resolve);

    await this.wait.promise;
    this.socket = tlsSocket;

    this.socket.addListener("readable", () => this.wait?.resolve());
    this.socket.addListener("close", () => this.wait?.reject(new Error("PostgreSQL socket closed")));
    this.socket.addListener("error", (err) => this.wait?.reject(err));
  }

  /** Calls a callback with a requestbuilder to build a request synchronously, and sends it immediately.
   * Returns the new index in the request builder after writing. WHen a response is received, call signalAnswered
   * with that index.
  */
  write(cb: (builder: RequestBuilder) => void) {
    const startIdx = this.requestBuilder.idx;
    cb(this.requestBuilder);
    // Write the built request to the socket
    const buf = this.requestBuilder.buffer.subarray(startIdx, this.requestBuilder.idx);
    // Just write the buffer directly, don't expect too many writes at the same time
    this.socket.write(buf);
    return this.requestBuilder.idx;
  }

  /** Call when an answer has been received for a query, so the requestbuilder knows its buffer can be reused. */
  ackWrite(idx: number) {
    if (this.requestBuilder.idx === idx)
      this.requestBuilder.reset();
  }

  /** Reads a single byte from the buffer. Should only be used in startup phase before
   * reading packets.
   */
  async readSingleByte(): Promise<number> {
    // Only used in startup. Will usually wait, so no need for sync version
    while (true) {
      if (this.bufferIdx !== this.bufferEnd) {
        return this.buffer[this.bufferIdx++];
      }
      await this.readBuffer();
      this.dataView = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    }
  }

  /** Reads a packet. Returns immediately when the next packet is available in curPacket, or
   * a promise that resolves when the packet is available.
   */
  readPacket(): Promise<void> | void {
    const gotLen = this.bufferEnd - this.bufferIdx;
    let len: number;
    if (gotLen >= 5 && (len = this.dataView.getUint32(this.bufferIdx + 1)) + 1 <= gotLen) {
      // packet available in receive buffer. Make sure the curPacket points to the right buffer
      if (this.curPacket.buffer !== this.buffer) {
        this.curPacket.buffer = this.buffer;
        this.curPacket.dataview = this.dataView;
      }
      this.curPacket.code = this.buffer[this.bufferIdx];
      this.curPacket.dataStart = this.bufferIdx + 5;
      this.curPacket.dataLen = len - 4;
      this.bufferIdx += len + 1;
      //console.log(`readPacket: code: ${String.fromCharCode(this.curPacket.code)}: ${getCodeName(this.curPacket.code, true)}`);
      return;
    }
    // Not enough data. Copy what we have to the scratch buffer and read the rest async
    if (this.scratchBuffer.length < gotLen) {
      const newBuffer = Buffer.allocUnsafe(gotLen + 16384) as UndocumentedBuffer;
      this.scratchBuffer.copy(newBuffer, 0, 0, gotLen);
      this.scratchBuffer = newBuffer;
      this.scratchDataView = new DataView(this.scratchBuffer.buffer, this.scratchBuffer.byteOffset, this.scratchBuffer.byteLength);
    }
    this.buffer.copy(this.scratchBuffer, 0, this.bufferIdx, this.bufferEnd);
    this.bufferIdx = this.bufferEnd;
    return this.readPacketAsync(gotLen);
  }

  close() {
    this.socket.end();
    this.socket.destroy();
    this.wait?.reject(new Error("PostgreSQL socket closed"));
  }
}

/** Connect to a PostgreSQL server */
export async function connectSocket(connectionOptions: {
  host?: string;
  port?: number;
  keepAlive?: boolean;
  timeoutMs?: number;
}) {
  const socket = new net.Socket();
  const defer = Promise.withResolvers<void | false>();

  if (connectionOptions.timeoutMs)
    setTimeout(() => defer.reject(new Error(`Timeout connecting to PostgreSQL`)), connectionOptions.timeoutMs);
  socket.on('error', (err) => defer.reject(err));

  const host = (connectionOptions.host ?? process.env.WEBHARE_PGHOST ?? process.env.PGHOST) || "localhost";
  const port = (connectionOptions.port ?? Number(process.env.PGPORT)) || (5432 satisfies DefaultPostgreSQLPort);

  if (host.startsWith('/')) {
    // Unix socket
    const socketPath = path.join(host, ".s.PGSQL." + port);
    socket.connect(socketPath, defer.resolve);
  } else {
    socket.connect(port, host, defer.resolve);
  }

  if (connectionOptions.keepAlive)
    socket.setKeepAlive(true);
  socket.setNoDelay(true);

  try {
    await defer.promise;
    return new PGPacketSocket(socket);
  } catch (e) {
    socket.destroy();
    throw e;
  }
}
