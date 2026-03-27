import { DatabaseError } from "./error";
import { parseErrorResponse, parseNoticeResponse, parseParameterStatus } from "./response-parser";
import type { Query, QueryInterface } from "./types/conn-types";
import type * as Code from "./types/protocol-codes";

export type PGPassthroughQueryCallback = (data: Buffer | Error | null) => void;

export class PassthroughQuery implements Query {
  conn: QueryInterface;
  query: AsyncIterable<Buffer> | Iterable<Buffer>;
  queryComplete = false;
  expectedReadyForQueries = 0;
  maybeMoreIncomingSyncs: PromiseWithResolvers<boolean> | null = null;
  callback?: PGPassthroughQueryCallback;

  constructor(conn: QueryInterface, queryBuffers: Buffer | AsyncIterable<Buffer>, callback: PGPassthroughQueryCallback) {
    this.conn = conn;
    this.query = "byteLength" in queryBuffers ? [queryBuffers] : queryBuffers;
    this.callback = callback;
    if (!this.callback)
      throw new Error("PassthroughQuery requires a callback");
  }

  checkQueryBuffer(queryBuffer: Buffer) {
    /** Check if the packet contains valid packet lengths, only whole packets. Also count the number of syncs
     * and return the code of the last packet (so it can be verified that the last packet of a query
     * is a sync. Packet is in format ((byte code)(4 byte length)(data))[]
     */
    let offset = 0;
    let code;
    let syncs = 0;
    while (offset + 5 <= queryBuffer.length) {
      code = queryBuffer.readUInt8(offset);
      const length = queryBuffer.readUInt32BE(offset + 1);
      if (length < 4 || offset + 1 + length > queryBuffer.length)
        throw new Error(`Invalid packet length in passthrough query packets at offset ${offset}: ${length}, but only ${queryBuffer.length - offset - 1} bytes remain`);
      if (code === 83 satisfies Code.CodeSync)
        syncs++;
      offset += 1 + length;
    }
    if (offset !== queryBuffer.length)
      throw new Error(`Invalid packet header in passthrough query packets at offset ${offset}: got ${queryBuffer.length - offset} bytes, expected 5 or more`);
    this.expectedReadyForQueries += syncs;
    return code;
  }

  writeQuery(): Promise<undefined> | undefined {
    // Run the iterator over the query buffers as sync as possible
    if (Symbol.asyncIterator in this.query)
      return this.writeQueryAsync();

    let registered = false;
    try {
      let lastCode;
      for (const buffer of this.query) {
        lastCode = this.checkQueryBuffer(buffer);
        this.conn["socket"]["writeTrustedBuffer"](buffer);
        if (!registered) {
          this.conn["registerSentQuery"](this);
          registered = true;
        }
      }
      if (lastCode !== 83 satisfies Code.CodeSync)
        throw new Error(`Passthrough query packets must end with a Sync message`);
    } catch (e) {
      // Only need to conclude the query if we already wrote something to the socket and the query was registered
      if (registered) {
        this.conn["socket"].write(b => b.sync());
        ++this.expectedReadyForQueries;
      }
      this.callback?.(e as Error);
      this.callback = undefined;
    }
    this.queryComplete = true;
    this.conn["socket"].finishedQuery();
  }

  async writeQueryAsync(): Promise<undefined> {
    let registered = false;
    try {
      let lastCode;
      this.maybeMoreIncomingSyncs = Promise.withResolvers();
      for await (const buffer of this.query) {
        lastCode = this.checkQueryBuffer(buffer);
        this.conn["socket"]["writeTrustedBuffer"](buffer);
        if (!registered) {
          this.conn["registerSentQuery"](this);
          registered = true;
        }
        // Allow processing of incoming packets
        this.maybeMoreIncomingSyncs.resolve(true);
        this.maybeMoreIncomingSyncs = Promise.withResolvers();
      }
      if (lastCode !== 83 satisfies Code.CodeSync)
        throw new Error(`Passthrough query packets must end with a Sync message`);
      this.maybeMoreIncomingSyncs.resolve(false);
    } catch (e) {
      // Only need to conclude the query if we already wrote something to the socket and the query was registered
      if (registered) {
        this.conn["socket"].write(b => b.sync());
        ++this.expectedReadyForQueries;
      }
      this.maybeMoreIncomingSyncs?.resolve(false);
      this.callback?.(e as Error);
      this.callback = undefined;
    }
    this.conn["socket"].finishedQuery();
    this.queryComplete = true;
  }

  async procesQuery(): Promise<void> {
    const socket = this.conn["socket"];
    const packet = socket.curPacket;

    let curBuffer: Buffer | null = Buffer.allocUnsafe(65536);
    let curOffset = 0;

    // Gather sync arriving packets into larger buffers to reduce callback calls
    let error: Error | null = null;
    while (!this.queryComplete || this.expectedReadyForQueries) {
      const res = socket.readPacket();
      if (res) {
        if (curOffset) {
          this.callback?.(curBuffer!.subarray(0, curOffset));
          curOffset = 0;
          curBuffer = null;
        }
        await res;
      }

      curBuffer ??= Buffer.allocUnsafe(Math.max(packet.dataLen + 5, 16384));
      if (curOffset + packet.dataLen + 5 > curBuffer.length) {
        const newBuffer = Buffer.allocUnsafe(Math.max(curBuffer.length * 2, curOffset + packet.dataLen + 5));
        curBuffer.copy(newBuffer, 0, 0, curOffset);
        curBuffer = newBuffer;
      }
      packet.buffer.copy(curBuffer, curOffset, packet.dataStart - 5, packet.dataStart + packet.dataLen);
      curOffset += packet.dataLen + 5;

      //this.response["addBuffer"](packet.buffer, packet.dataStart - 5, packet.dataLen + 5);
      if (packet.code === 90 satisfies Code.CodeReadyForQuery) {
        if (!this.expectedReadyForQueries--) {
          if (!await this.maybeMoreIncomingSyncs?.promise && !this.expectedReadyForQueries)
            break;
        }
      } else if (packet.code === 69 satisfies Code.CodeErrorResponse) {
        const parsed = parseErrorResponse(packet);
        if (parsed.severity === "FATAL" || parsed.severity === "PANIC") {
          error = new DatabaseError(parsed);
          break;
        }
      } else if (packet.code === 78 satisfies Code.CodeNoticeResponse) {
        const notice = parseNoticeResponse(packet);
        // FIXME: what to do with the notice?
        void notice;
      } else if (packet.code === 83 satisfies Code.CodeParameterStatus) {
        const parsed = parseParameterStatus(packet);
        this.conn["parameters"][parsed.key] = parsed.value;
      }
    }
    if (curOffset)
      this.callback?.(curBuffer!.subarray(0, curOffset));

    if (error) {
      this.callback?.(error);
      this.callback = undefined;
      // fatal error occurred, stop connection processing
      throw error;
    }
    this.callback?.(null);
    this.callback = undefined;
  }

  gotConnectionClose(err: Error) {
    this.callback?.(err);
    this.callback = undefined;
  }
}
