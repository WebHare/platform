import type { CodecRegistry } from "../codec-registry";
import type { RowDecoderData } from "../codec-support";
import type { NoticeResponse } from "../response-parser";
import type { SocketQueryInterface } from "../socket";
import type { AnyCodec, CodecContext } from "./codec-types";

export interface Query {
  queryStart: number;
  writeQuery(): undefined | Promise<undefined>;
  procesQuery(): Promise<void>;
  gotConnectionClose(err: Error): void;
}

export type CachedDescription = {
  params?: AnyCodec[];
  decoder?: RowDecoderData;
  columns: { fieldName: string; dataTypeId: number; codec: AnyCodec }[];
};

export interface QueryInterface {
  socket: SocketQueryInterface;
  defaultCodecRegistry: CodecRegistry;
  descriptionMap: Map<string, CachedDescription>;
  parameters: Record<string, string>;
  codecContext: CodecContext;

  registerSentQuery(query: Query): void;
  gotNotice(query: Query, notice: NoticeResponse): void;
}
