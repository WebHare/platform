/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as tls from "tls";
import { connectSocket, type PGPacketSocket, type SocketQueryInterface, type SocketResponse } from "./socket";
import * as net from "net";
import type * as Code from "./types/protocol-codes";
import { parseAuthentication, parseBackendKeyData, parseErrorResponse, parseNegotiateProtocolVersion, parseNoticeResponse, parseParameterStatus, type BackendKeyData } from "./response-parser";
import { defaultCodecs } from "./codecs";
import type { Codec, CodecContext } from "./types/codec-types";
import { CodecRegistry } from "./codec-registry";
import type { CachedDescription, Query } from "./types/conn-types";
import { DatabaseError } from "./error";
import { NormalQuery } from "./normalquery";
import { PGBoundParam } from "./boundparam";
import { PassthroughQuery, type PGPassthroughQueryCallback } from "./passthroughquery";

export type { PGPassthroughQueryCallback } from "./passthroughquery";

export type PGConnectionOptions = {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  ssl?: tls.ConnectionOptions;
  codecRegistry?: CodecRegistry;
  codecContext?: CodecContext;
};

export type PGExecuteOptions = {
  codecRegistry?: CodecRegistry;
};

export type PGQueryOptions = {
  paramTypes?: (number | string | undefined)[];
  inferTypesFromQuery?: boolean;
  codecRegistry?: CodecRegistry;
};

let defaultCodecRegistry: CodecRegistry | undefined;

export async function connect(connectionOptions: PGConnectionOptions = {}): Promise<PGConnection> {
  // Connect to the socket
  const socket = await connectSocket(connectionOptions);

  try {
    // Connect over tls when connectionOptions.ssl is set
    if (connectionOptions.ssl) {
      // See if the server supports SSL
      socket.write(b => b.sslRequest());

      const byteResponse = await socket.readSingleByte();
      if (byteResponse === 78 satisfies Code.EncryptionResponseNo) {
        // No SSL, continue as normal
      } else if (byteResponse === 83 satisfies Code.EncryptionResponseSSL) {
        const tlsOptions: tls.ConnectionOptions = connectionOptions.ssl ?? {};
        const host = connectionOptions.host || process.env.PGHOST || "localhost";
        if (!net.isIP(host) && !tlsOptions.servername)
          tlsOptions.servername = host;
        await socket.switchToTLS(tlsOptions);
      } else
        throw new Error(`Unexpected response to SSL request: ${byteResponse}`);
    }

    // We're now connected and will receive only packets (code + length + data)
    const packet = socket.curPacket;

    const parameters: Record<string, string> = {};
    let backendKeyData: BackendKeyData | null = null;

    // Write the startup message and read the response
    const startupIdx = socket.write(b => b.startupMessage(connectionOptions.user || process.env.PGUSER || "postgres", connectionOptions.database || process.env.PGDATABASE || "postgres"));
    while (true) {
      { const res = socket.readPacket(); if (res) await res; }

      if ((packet as SocketResponse).code === 118 satisfies Code.CodeNegotiateProtocolVersion) {
        const response = parseNegotiateProtocolVersion(packet);
        if (response.version > 196610 || response.version < 196608)
          throw new Error(`Unsupported protocol version negotiated: ${response.version >> 16}.${response.version & 0xFFFF}`);
        // version 3.0 and 3.2 are compatible enough to proceed without changes
      } else if ((packet as SocketResponse).code === 82 satisfies Code.CodeAuthentication) {
        // Handle authentication
        const authResponse = parseAuthentication(packet);
        switch (authResponse.type) {
          case 0 satisfies Code.AuthenticationOk:
            // Authentication successful
            break;
          case 3 satisfies Code.AuthenticationCleartextPassword:
            throw new Error("Cleartext password authentication is not supported");
          case 5 satisfies Code.AuthenticationMD5Password:
            throw new Error("MD5 password authentication is not supported");
          default:
            throw new Error(`Unsupported authentication type: ${authResponse.type}`);
        }
      } else if ((packet as SocketResponse).code === 83 satisfies Code.CodeParameterStatus) {
        const parsed = parseParameterStatus(packet);
        parameters[parsed.key] = parsed.value;
      } else if ((packet as SocketResponse).code === 75 satisfies Code.CodeBackendKeyData) {
        backendKeyData = parseBackendKeyData(packet);
      } else if ((packet as SocketResponse).code === 90 satisfies Code.CodeReadyForQuery) {
        break;
      } else if ((packet as SocketResponse).code === 69 satisfies Code.CodeErrorResponse) {
        throw new DatabaseError(parseErrorResponse(packet));
      } else if ((packet as SocketResponse).code === 78 satisfies Code.CodeNoticeResponse) {
        const notice = parseNoticeResponse(packet);
        // FIXME: what to do with the notice?
        void notice;
      } else
        throw new Error(`Unexpected message type ${String.fromCharCode(packet.code)}`);
    }

    socket.ackWrite(startupIdx);

    if (!connectionOptions.codecRegistry) {
      connectionOptions.codecRegistry = defaultCodecRegistry ??= new CodecRegistry(defaultCodecs);
    }

    // Current packet is ReadyForQuery
    return new PGConnection(socket, backendKeyData, parameters, {
      ...connectionOptions,
      codecRegistry: connectionOptions.codecRegistry ?? (defaultCodecRegistry ??= new CodecRegistry(defaultCodecs)),
    });
  } catch (err) {
    socket.close();
    throw err;
  }
}

export interface PGQueryResult<R = any> {
  command: string;
  rowCount: number;
  rows: R[];
  fields: { fieldName: string; dataTypeId: number; codec: Codec<any, any> }[];
}

class PGQueryInterface {
  conn: PGConnection;
  socket: SocketQueryInterface;
  defaultCodecRegistry: CodecRegistry;
  descriptionMap: Map<string, CachedDescription> = new Map();
  parameters: Record<string, string>;
  codecContext: CodecContext;

  constructor(conn: PGConnection, codecRegistry: CodecRegistry, parameters: Record<string, string>, codecContext: CodecContext) {
    this.conn = conn;
    this.socket = conn["socket"];
    this.defaultCodecRegistry = codecRegistry;
    this.parameters = parameters;
    this.codecContext = codecContext;
  }

  registerSentQuery(query: Query) {
    this.conn["queries"].push(query);
    if (this.conn["queries"].length === 1)
      this.conn["querySignal"].resolve();
  }
}

export class PGConnection {
  private socket: PGPacketSocket;
  private connectionOptions: PGConnectionOptions;
  private backendKeyData: BackendKeyData | null = null;
  private waitWriteQuery: Promise<undefined> | undefined;
  private closeError: Error | undefined;
  private queryInterface: PGQueryInterface;

  private queries: Query[] = [];
  private querySignal = Promise.withResolvers<void>();

  constructor(socket: PGPacketSocket, backendKeyData: BackendKeyData | null, parameters: Record<string, string>, connectionOptions: PGConnectionOptions & { codecRegistry: CodecRegistry }) {
    this.socket = socket;
    this.connectionOptions = connectionOptions;
    this.backendKeyData = backendKeyData;
    this.queryInterface = new PGQueryInterface(this, connectionOptions.codecRegistry, parameters, connectionOptions.codecContext);
    void this.commandLoop();
  }

  private async commandLoop() {
    while (true) {
      const query = this.queries[0];
      if (!query) {
        await this.querySignal.promise;
        continue;
      }

      try {
        await query.procesQuery();
      } catch (e) {
        this.terminateConnection(e as Error);
        return false;
      }

      this.queries.shift();
      if (this.queries.length === 0)
        this.querySignal = Promise.withResolvers<void>();
    }
  }

  private terminateConnection(error: Error) {
    this.closeError = error;
    for (const q of this.queries) {
      q.gotConnectionClose(error);
    }
    this.socket.close();
  }

  private scheduleQuery(query: Query) {
    // do we need to wait for another query to be written?
    if (!this.waitWriteQuery)
      this.waitWriteQuery = query.writeQuery();
    else
      this.waitWriteQuery = this.waitWriteQuery.then(() => query.writeQuery());
    if (this.waitWriteQuery) {
      const currentWait = this.waitWriteQuery;
      // Clear the waitWriteQuery when done and no other queries are waiting
      void currentWait.then(() => {
        if (this.waitWriteQuery === currentWait)
          this.waitWriteQuery = undefined;
      }, () => 0);
    }
  }

  query(sql: string, params?: unknown[], options?: PGQueryOptions): Promise<PGQueryResult> {
    if (this.closeError)
      throw new Error(`Connection is closed: ${this.closeError.message}`);

    const query = new NormalQuery(this.queryInterface, sql, params, options);
    this.scheduleQuery(query);
    return query.response.promise;
  }

  passthroughQuery(queryPackets: Buffer | AsyncIterable<Buffer>, callback: PGPassthroughQueryCallback): void {
    if (this.closeError)
      throw new Error(`Connection is closed: ${this.closeError.message}`);

    const query = new PassthroughQuery(this.queryInterface, queryPackets, callback);
    this.scheduleQuery(query);
  }

  async close() {
    this.socket.close();
  }

  getRefObject(): { ref(): void; unref(): void } {
    return this.socket["orgSocket"];
  }

  getBackendProcessId(): number | undefined {
    return this.backendKeyData?.processId;
  }

  async cancelQuery() {
    if (!this.backendKeyData)
      throw new Error("Can't cancel query on a connection without backend key data");

    // Connect to the socket
    const socket = await connectSocket(this.connectionOptions);
    socket.write(b => b.cancelRequest(this.backendKeyData!.processId, this.backendKeyData!.secretKey));
    socket.close();
  }
}

export function bindParam(value: unknown, type: string | number): PGBoundParam {
  return new PGBoundParam(value, type);
}
