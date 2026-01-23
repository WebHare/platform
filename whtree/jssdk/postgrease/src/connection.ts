/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as tls from "tls";
import { connectSocket, type PGPacketSocket, type SocketResponse } from "./socket";
import * as net from "net";
import type * as Code from "./types/protocol-codes";
import { parseAuthentication, parseBackendKeyData, parseCommandComplete, parseErrorResponse, parseNegotiateProtocolVersion, parseNoticeResponse, parseParameterDescription, parseParameterStatus, type BackendKeyData, type ErrorResponse } from "./response-parser";
import { DataTypeFallbackDecoder, defaultCodecs } from "./codecs";
import { getRowDecoder, type RowDecoderData } from "./codec-support";
import type { AnyCodec, Codec } from "./types/codec-types";
import { CodecRegistry } from "./codec-registry";


export type PGConnectionOptions = {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
  ssl?: tls.ConnectionOptions;
  codecRegistry?: CodecRegistry;
};

export type PGExecuteOptions = {
  codecRegistry?: CodecRegistry;
};

export type PGQueryOptions = {
  paramTypes?: (number | string | undefined)[];
  inferTypesFromQuery?: boolean;
  codecRegistry?: CodecRegistry;
};

export class PGBoundParam {
  value: unknown;
  type: string | number;

  constructor(value: unknown, type: string | number) {
    this.value = value;
    this.type = type;
  }
}

let defaultCodecRegistry: CodecRegistry | undefined;

export class DatabaseError extends Error implements ErrorResponse {
  severity: "ERROR" | "FATAL" | "PANIC" = "ERROR";
  code = "";

  severityLocalized?: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;

  query?: string;
  parameterTypes?: string[];

  constructor(data: ErrorResponse) {
    super(data.message ?? "Unknown error, no message specified");
    Object.assign(this, data);
  }
}

export async function connect(connectionOptions: PGConnectionOptions = {}) {
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

    // We're now connected and will receiuve only packets (code + length + data )
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
    return new PGConnection(socket, backendKeyData, parameters, connectionOptions.codecRegistry);
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


type CachedDescription = {
  params?: Codec<any, any>[];
  decoder?: RowDecoderData;
  columns: { fieldName: string; dataTypeId: number; codec: Codec<any, any> }[];
};


const noDataDecoder: RowDecoderData = {
  func: () => ({}),
  context: { cols: [], throwError: () => 0 }
};

export class PGConnection {
  private socket: PGPacketSocket;
  private backendKeyData: BackendKeyData | null = null;
  private defaultCodecRegistry: CodecRegistry;
  private descriptionMap: Map<string, CachedDescription> = new Map();
  private waitWriteQuery: Promise<undefined> | undefined;
  private parameters: Record<string, string>;
  private closeError: Error | undefined;

  private queries: {
    sql: string;
    params: unknown[];
    haveMissingParamCodec: boolean;
    haveRowDescription: boolean;
    response: PromiseWithResolvers<PGQueryResult>;
    desc: CachedDescription;
    codecRegistry: CodecRegistry;
    resolveDesc?: (arg: Required<CachedDescription> | null) => void;
    onError?: (err: Error) => void;
    writeIdx?: number;
  }[] = [];
  private querySignal = Promise.withResolvers<void>();

  constructor(socket: PGPacketSocket, backendKeyData: BackendKeyData | null, parameters: Record<string, string>, codecRegistry: CodecRegistry) {
    this.socket = socket;
    this.backendKeyData = backendKeyData;
    this.parameters = parameters;
    this.defaultCodecRegistry = codecRegistry;
    void this.commandLoop();
  }

  private parseRowDescription(packet: SocketResponse, columns: { fieldName: string; dataTypeId: number; codec: Codec<any, any> }[], codecRegistry: CodecRegistry): RowDecoderData {
    const fieldCount = packet.dataview.getUint16(packet.dataStart);// buffer.readUInt16BE(packet.dataStart);
    let offset = packet.dataStart + 2;
    columns.splice(0, columns.length);
    for (let i = 0; i < fieldCount; i++) {
      const fieldNameEnd = packet.buffer.indexOf(0, offset);
      const fieldName = packet.buffer.utf8Slice(offset, fieldNameEnd);
      offset = fieldNameEnd + 1;
      const dataTypeOid = packet.dataview.getUint32(offset + 6); // buffer.readUInt32BE(offset + 6);
      offset += 18;
      const codec = codecRegistry.getCodecByOid(dataTypeOid) ?? DataTypeFallbackDecoder as AnyCodec;
      columns.push({ fieldName, dataTypeId: dataTypeOid, codec });
    }
    return getRowDecoder(columns);
  }

  private async commandLoop() {
    const packet = this.socket.curPacket;
    while (true) {
      const query = this.queries[0];
      if (!query) {
        await this.querySignal.promise;
        continue;
      }

      let decoder!: RowDecoderData["func"];
      let decoderContext!: RowDecoderData["context"];

      if (query.desc.decoder)
        ({ func: decoder, context: decoderContext } = query.desc.decoder);

      try {
        const rows: object[] = [];
        let tag = "";

        { const res = this.socket.readPacket(); if (res) await res; }

        query:
        do {
          let processedAny = false;
          /* We'll process the possible messages in a loop in their expected order until we reach ReadyForQuery.
             If a rare out-of-order message (parameter status changes, notices etc) is encountered, we'll process
             it at the end and then loop again.

             Possible sequences:
              1: SELECT with known param types and row description (row description might have been cached)
                  ParseComplete
                  BindComplete
                  (RowDescription | NoData)?
                  DataRow*
                  CommandComplete
                  ReadyForQuery
              2: SELECT with missing param types (ignoreFirstReadyForQuery = true)
                  ParseComplete
                  ParameterDescription
                  (RowDescription | NoData)
                  //ReadyForQuery
                  BindComplete
                  DataRow*
                  CommandComplete
                  ReadyForQuery
          */
          if ((packet as SocketResponse).code === 49 satisfies Code.CodeParseComplete) {
            processedAny = true;
            const res = this.socket.readPacket(); if (res) await res;
          }
          if ((packet as SocketResponse).code === 50 satisfies Code.CodeBindComplete) {
            processedAny = true;
            const res = this.socket.readPacket(); if (res) await res;
          }
          if (packet.code === 116 satisfies Code.CodeParameterDescription) {
            processedAny = true;
            const paramOids = parseParameterDescription(packet);
            const desc = query.desc;
            desc.params = [];
            for (const o of paramOids) {
              const codec = query.codecRegistry.getCodecByOid(o);
              if (!codec)
                throw new Error(`No codec for parameter type OID: ${o}`);
              desc.params.push(codec);
            }
            if (desc.decoder && desc.params)
              query.resolveDesc?.(desc as Required<CachedDescription>);
            const res = this.socket.readPacket(); if (res) await res;
          }
          if ((packet as SocketResponse).code === 84 satisfies Code.CodeRowDescription) {
            processedAny = true;
            query.desc.decoder = this.parseRowDescription(packet, query.desc.columns, query.codecRegistry);
            ({ func: decoder, context: decoderContext } = query.desc.decoder);
            query.resolveDesc?.(query.desc as Required<CachedDescription>);
            const res = this.socket.readPacket(); if (res) await res;
          } else if ((packet as SocketResponse).code === 110 satisfies Code.CodeNoData) {
            processedAny = true;
            query.desc.decoder = noDataDecoder;
            query.resolveDesc?.(query.desc as Required<CachedDescription>);
            const res = this.socket.readPacket(); if (res) await res;
          }
          // TODO: test if remobing the first Sync in two-stage queries and adding a CodeBindComplete handler here speeds things up
          while (packet.code === 68 satisfies Code.CodeDataRow) {
            processedAny = true;
            rows.push(decoder(decoderContext, packet.buffer, packet.dataview, packet.dataStart, packet.dataLen));
            { const res = this.socket.readPacket(); if (res) await res; }
          }
          if (packet.code === 67 satisfies Code.CodeCommandComplete) {
            processedAny = true;
            tag = parseCommandComplete(packet);
            { const res = this.socket.readPacket(); if (res) await res; }
          }
          if (packet.code === 90 satisfies Code.CodeReadyForQuery)
            break query;
          // Uncommon messages that can appear anywhere
          if (packet.code === 69 satisfies Code.CodeErrorResponse) {
            processedAny = true;
            const error = new DatabaseError(parseErrorResponse(packet));
            error.query = query.sql;
            error.parameterTypes = query.params.map((p, i) => query.desc.params?.[i]?.name ?? typeof p);
            query.response.reject(error);
            if (error.severity === "FATAL" || error.severity === "PANIC") {
              this.terminateConnection(error);
              // no further processing needed
              return;
            }
            { const res = this.socket.readPacket(); if (res) await res; }
          } else if (packet.code === 78 satisfies Code.CodeNoticeResponse) {
            processedAny = true;
            const notice = parseNoticeResponse(packet);
            // FIXME: what to do with the notice?
            void notice;
            { const res = this.socket.readPacket(); if (res) await res; }
          } else if (packet.code === 83 satisfies Code.CodeParameterStatus) {
            processedAny = true;
            const parsed = parseParameterStatus(packet);
            this.parameters[parsed.key] = parsed.value;
            { const res = this.socket.readPacket(); if (res) await res; }
          } else if (!processedAny)
            throw new Error(`Unexpected message code in query response: ${String.fromCharCode(packet.code)}`);

          // eslint-disable-next-line no-constant-condition
        } while (true);
        if (rows.length && !query.desc.columns.length) {
          throw new Error(`Received rows but no column description`);
        }

        query.response.resolve({
          command: tag.slice(0, tag.indexOf(' ')) || tag,
          rowCount: parseInt(tag.slice(tag.lastIndexOf(' ') + 1)) || 0,
          rows,
          fields: query.desc.columns,
        });

        if (query.writeIdx)
          this.socket.ackWrite(query.writeIdx);
      } catch (err) {
        // Let the query writer know about the error, so it can send a Sync if needed
        query.resolveDesc?.(null);
        query.response.reject(err);

        try {
          // read until the next ReadyForQuery
          while (true) {
            { const res = this.socket.readPacket(); if (res) await res; }
            if (packet.code === 90 satisfies Code.CodeReadyForQuery)
              break;
          }
        } catch (e) {
          this.terminateConnection(e as Error);
          return;
        }
      } finally {
        this.queries.shift();
        if (this.queries.length === 0) {
          this.querySignal = Promise.withResolvers<void>();
        }
      }
    }
  }

  private terminateConnection(error: Error) {
    this.closeError = error;
    for (const q of this.queries) {
      q.response.reject(error);
    }
    this.socket.close();
  }

  query(sql: string, params?: unknown[], options?: PGQueryOptions): Promise<PGQueryResult> {
    if (this.closeError)
      throw new Error(`Connection is closed: ${this.closeError.message}`);

    params ??= [];
    const queryResponse = Promise.withResolvers<PGQueryResult>();
    const codecRegistry = options?.codecRegistry ?? this.defaultCodecRegistry;

    const paramCodecs: (Codec<any, any> | undefined)[] = [];
    let paramIdx = 0;
    let haveMissingParamCodec = false;
    for (const param of params) {
      let codec: Codec<any, any> | undefined;
      if (param instanceof PGBoundParam) {
        codec = codecRegistry.getCodec(param.type);
        if (!codec)
          throw new Error(`No codec for parameter type name: ${param.type}`);
        params![paramIdx] = param.value;
      } else {
        const type = options?.paramTypes?.[paramIdx];
        if (typeof type === 'number') {
          codec = codecRegistry.getCodecByOid(type);
          if (!codec)
            throw new Error(`No codec for parameter type OID: ${type}`);
        } else if (typeof type === 'string') {
          codec = codecRegistry.getCodecByName(type);
          if (!codec)
            throw new Error(`No codec for parameter type name: ${type}`);
        } else if (!options?.inferTypesFromQuery) {
          codec = codecRegistry.determineCodec(param) ?? undefined;
          if (!codec)
            haveMissingParamCodec = true;
        } else
          haveMissingParamCodec = true;
      }
      ++paramIdx;
      paramCodecs.push(codec!);
    }

    const paramOids = paramCodecs.map(c => c?.oid ?? 0);
    const queryKey = `${sql}\x00${paramOids.join(",")}`;
    let desc = this.descriptionMap.get(queryKey);
    if (!desc)
      this.descriptionMap.set(queryKey, desc = { columns: [] });

    if (!haveMissingParamCodec)
      desc.params = paramCodecs as Codec<unknown, unknown>[];

    const query: typeof this.queries[number] = {
      sql,
      params,
      haveMissingParamCodec,
      haveRowDescription: false,
      response: queryResponse,
      desc,
      codecRegistry,
    };

    // do we need to wait for another query to be written?
    if (!this.waitWriteQuery) {
      this.waitWriteQuery = this.writeQuery(query, queryKey, params, paramCodecs, paramOids);
    } else {
      const newWaitQuery: Promise<undefined> = this.waitWriteQuery.then(() => this.writeQuery(query, queryKey, params, paramCodecs, paramOids));
      this.waitWriteQuery = newWaitQuery;
      // Clear the waitWriteQuery when done and no other queries are waiting
      newWaitQuery.then(() => {
        if (this.waitWriteQuery === newWaitQuery)
          this.waitWriteQuery = undefined;
      }, () => 0);
    }
    return queryResponse.promise;
  }

  private writeQuery(query: typeof this.queries[number], queryKey: string, params: unknown[], paramCodecs: (Codec<any, any> | undefined)[], paramOids: number[]): undefined | Promise<undefined> {

    // no blocks. Do we have a cached description or are all paramCodecs known?
    query.haveRowDescription = query.desc.decoder !== undefined;
    if (!query.haveMissingParamCodec) {
      query.writeIdx = this.socket.write(b => {
        b.parse("", query.sql, paramOids);
        b.bind("", "", params, query.desc?.params ?? paramCodecs as Codec<unknown, unknown>[]);
        if (!query.haveRowDescription)
          b.describe(true, "");
        b.execute("", 0);
        b.sync();

        // request built correctly, schedule processing
        this.queries.push(query);
        if (this.queries.length === 1)
          this.querySignal.resolve();
      });
    } else {
      // Path taken when a codec could not be determined for at least one parameter.
      this.socket.write(b => {
        b.parse("", query.sql, paramOids);
        b.describe(false, "");
        b.flush();

        // request built correctly, schedule processing
        this.queries.push(query);
        if (this.queries.length === 1)
          this.querySignal.resolve();
      });

      const res = Promise.withResolvers<undefined>();
      query.resolveDesc = newDesc => {
        // TODO: revalidate params with newly selected codecs
        query.resolveDesc = undefined; // prevent multiple calls
        if (!newDesc) {
          query.writeIdx = this.socket.write(b => b.sync());
        } else {
          this.descriptionMap.set(queryKey, newDesc);
          query.writeIdx = this.socket.write(b => {
            try {
              b.bind("", "", params, newDesc.params);
              b.execute("", 0);
              b.sync();
            } catch (e) {
              // Error constructing the rest of the query. Send a Sync to recover the connection handler
              b.reset();
              b.sync();
              query.response.reject(e as Error);
              res.resolve(undefined);
              throw e;
            }
          });
        }
        res.resolve(undefined);
      };
      return res.promise;
    }
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
}

export function bindParam(value: unknown, type: string | number): PGBoundParam {
  return new PGBoundParam(value, type);
}
