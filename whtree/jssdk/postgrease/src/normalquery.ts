import { PGBoundParam } from "./boundparam";
import type { CodecRegistry } from "./codec-registry";
import type { RowDecoderData } from "./codec-support";
import type { PGQueryOptions, PGQueryResult } from "./connection";
import { DatabaseError } from "./error";
import { parseCommandComplete, parseErrorResponse, parseNoticeResponse, parseParameterDescription, parseParameterStatus, parseRowDescription } from "./response-parser";
import type { SocketResponse } from "./socket";
import type { AnyCodec } from "./types/codec-types";
import type { CachedDescription, Query, QueryInterface } from "./types/conn-types";
import type * as Code from "./types/protocol-codes";

const noDataDecoder: RowDecoderData = {
  func: () => ({}),
  context: { cols: [], throwError: () => 0 }
};

export class NormalQuery implements Query {
  conn: QueryInterface;
  options: PGQueryOptions;
  sql: string;
  params: unknown[];
  paramOids: number[];
  haveMissingParamCodec: boolean;
  haveRowDescription: boolean;
  response: PromiseWithResolvers<PGQueryResult>;
  desc: CachedDescription;
  codecRegistry: CodecRegistry;
  resolveDesc?: (arg: Required<CachedDescription> | null) => void;
  writeIdx?: number;
  paramCodecs: AnyCodec[] = [];
  queryKey: string;

  constructor(conn: QueryInterface, sql: string, params?: unknown[], options?: PGQueryOptions) {
    this.conn = conn;
    this.sql = sql;
    this.params = params ?? [];
    this.options = options ?? {};
    this.response = Promise.withResolvers<PGQueryResult>();
    this.haveRowDescription = false;

    this.codecRegistry = options?.codecRegistry ?? this.conn["defaultCodecRegistry"];

    this.haveMissingParamCodec = this.determineParamCodecs();

    this.paramOids = this.paramCodecs.map(c => c?.oid ?? 0);
    this.queryKey = `${sql}\x00${this.paramOids.join(",")}`;
    let desc = this.conn["descriptionMap"].get(this.queryKey);
    if (!desc)
      this.conn["descriptionMap"].set(this.queryKey, desc = { columns: [] });
    this.desc = desc;

    if (!this.haveMissingParamCodec)
      desc.params = this.paramCodecs as AnyCodec[];
  }

  determineParamCodecs(): boolean {
    let paramIdx = 0;
    let haveMissingParamCodec = false;
    for (const param of this.params) {
      let codec: AnyCodec | undefined;
      if (param instanceof PGBoundParam) {
        codec = this.codecRegistry.getCodec(param.type);
        if (!codec)
          throw new Error(`No codec for parameter type name: ${param.type}`);
        this.params[paramIdx] = param.value;
      } else {
        const type = this.options?.paramTypes?.[paramIdx];
        if (typeof type === 'number') {
          codec = this.codecRegistry.getCodecByOid(type);
          if (!codec)
            throw new Error(`No codec for parameter type OID: ${type}`);
        } else if (typeof type === 'string') {
          codec = this.codecRegistry.getCodecByName(type);
          if (!codec)
            throw new Error(`No codec for parameter type name: ${type}`);
        } else if (!this.options.inferTypesFromQuery) {
          codec = this.codecRegistry.determineCodec(param) ?? undefined;
          if (!codec)
            haveMissingParamCodec = true;
        } else
          haveMissingParamCodec = true;
      }
      ++paramIdx;
      this.paramCodecs.push(codec!);
    }
    return haveMissingParamCodec;
  }

  writeQuery(): undefined | Promise<undefined> {
    // no blocks. Do we have a cached description or are all paramCodecs known?
    this.haveRowDescription = this.desc.decoder !== undefined;
    if (!this.haveMissingParamCodec) {
      this.writeIdx = this.conn["socket"].write(b => {
        b.parse("", this.sql, this.paramOids);
        b.bind("", "", this.params, this.desc?.params ?? this.paramCodecs as AnyCodec[]);
        if (!this.haveRowDescription)
          b.describe(true, "");
        b.execute("", 0);
        b.sync();

        // request built correctly, schedule processing
        this.conn["registerSentQuery"](this);
      });
      this.conn["socket"].finishedQuery();
    } else {
      // Path taken when a codec could not be determined for at least one parameter.
      this.conn["socket"].write(b => {
        b.parse("", this.sql, this.paramOids);
        b.describe(false, "");
        b.flush();

        // request built correctly, schedule processing
        this.conn["registerSentQuery"](this);
      });

      const res = Promise.withResolvers<undefined>();
      this.resolveDesc = newDesc => {
        // TODO: revalidate params with newly selected codecs
        this.resolveDesc = undefined; // prevent multiple calls
        if (!newDesc) {
          this.writeIdx = this.conn["socket"].write(b => b.sync());
        } else {
          this.conn["descriptionMap"].set(this.queryKey, newDesc);
          this.writeIdx = this.conn["socket"].write(b => {
            try {
              b.bind("", "", this.params, newDesc.params);
              b.execute("", 0);
              b.sync();
            } catch (e) {
              // Error constructing the rest of the query. Send a Sync to recover the connection handler
              b.reset();
              b.sync();
              this.response.reject(e as Error);
              res.resolve(undefined);
              throw e;
            }
          });
          this.conn["socket"].finishedQuery();
        }
        res.resolve(undefined);
      };
      return res.promise;
    }
  }

  async procesQuery() {
    const socket = this.conn["socket"];
    const packet = socket.curPacket;

    let decoder!: RowDecoderData["func"];
    let decoderContext!: RowDecoderData["context"];
    const codecContext = this.conn.codecContext;

    if (this.desc.decoder)
      ({ func: decoder, context: decoderContext } = this.desc.decoder);

    const rows: object[] = [];
    let tag = "";

    { const res = socket.readPacket(); if (res) await res; }

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
        const res = socket.readPacket(); if (res) await res;
      }
      if ((packet as SocketResponse).code === 50 satisfies Code.CodeBindComplete) {
        processedAny = true;
        const res = socket.readPacket(); if (res) await res;
      }
      if (packet.code === 116 satisfies Code.CodeParameterDescription) {
        processedAny = true;
        const paramOids = parseParameterDescription(packet);
        const desc = this.desc;
        desc.params = [];
        for (const o of paramOids) {
          const codec = this.codecRegistry.getCodecByOid(o);
          if (!codec)
            throw new Error(`No codec for parameter type OID: ${o}`);
          desc.params.push(codec);
        }
        if (desc.decoder && desc.params)
          this.resolveDesc?.(desc as Required<CachedDescription>);
        const res = socket.readPacket(); if (res) await res;
      }
      if ((packet as SocketResponse).code === 84 satisfies Code.CodeRowDescription) {
        processedAny = true;
        this.desc.decoder = parseRowDescription(packet, this.desc.columns, this.codecRegistry);
        ({ func: decoder, context: decoderContext } = this.desc.decoder);
        this.resolveDesc?.(this.desc as Required<CachedDescription>);
        const res = socket.readPacket(); if (res) await res;
      } else if ((packet as SocketResponse).code === 110 satisfies Code.CodeNoData) {
        processedAny = true;
        this.desc.decoder = noDataDecoder;
        this.resolveDesc?.(this.desc as Required<CachedDescription>);
        const res = socket.readPacket(); if (res) await res;
      }
      // TODO: test if removing the first Sync in two-stage queries and adding a CodeBindComplete handler here speeds things up
      while (packet.code === 68 satisfies Code.CodeDataRow) {
        processedAny = true;
        rows.push(decoder(decoderContext, packet.buffer, packet.dataview, packet.dataStart, packet.dataLen, codecContext));
        { const res = socket.readPacket(); if (res) await res; }
      }
      if (packet.code === 67 satisfies Code.CodeCommandComplete) {
        processedAny = true;
        tag = parseCommandComplete(packet);
        { const res = socket.readPacket(); if (res) await res; }
      }
      if (packet.code === 90 satisfies Code.CodeReadyForQuery)
        break query;
      // Uncommon messages that can appear anywhere
      if (packet.code === 69 satisfies Code.CodeErrorResponse) {
        processedAny = true;
        const error = new DatabaseError(parseErrorResponse(packet));
        error.query = this.sql;
        error.parameterTypes = this.params.map((p, i) => this.desc.params?.[i]?.name ?? typeof p);
        this.response.reject(error);
        this.resolveDesc?.(null);
        if (error.severity === "FATAL" || error.severity === "PANIC")
          throw error;
        { const res = socket.readPacket(); if (res) await res; }
      } else if (packet.code === 78 satisfies Code.CodeNoticeResponse) {
        processedAny = true;
        const notice = parseNoticeResponse(packet);
        // FIXME: what to do with the notice?
        void notice;
        { const res = socket.readPacket(); if (res) await res; }
      } else if (packet.code === 83 satisfies Code.CodeParameterStatus) {
        processedAny = true;
        const parsed = parseParameterStatus(packet);
        this.conn["parameters"][parsed.key] = parsed.value;
        { const res = socket.readPacket(); if (res) await res; }
      } else if (!processedAny)
        throw new Error(`Unexpected message code in query response: ${String.fromCharCode(packet.code)}`);

      // eslint-disable-next-line no-constant-condition
    } while (true);
    if (rows.length && !this.desc.columns.length) {
      throw new Error(`Received rows but no column description`);
    }

    this.response.resolve({
      command: tag.slice(0, tag.indexOf(' ')) || tag,
      rowCount: parseInt(tag.slice(tag.lastIndexOf(' ') + 1)) || 0,
      rows,
      fields: this.desc.columns,
    });

    if (this.writeIdx)
      socket.ackWrite(this.writeIdx);
  }

  gotConnectionClose(err: Error) {
    this.response.reject(err);
  }
}
