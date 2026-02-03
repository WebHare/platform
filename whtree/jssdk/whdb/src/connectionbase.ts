import type { WebHareBlob } from '@webhare/services/src/webhareblob';
import type { PGPassthroughQueryCallback } from '@webhare/postgrease';
import type {
  PostgresPoolClient,
} from 'kysely';

export interface PoolClient extends PostgresPoolClient {
  passthroughQuery(query: Buffer | AsyncIterable<Buffer>, callback: PGPassthroughQueryCallback): void;
}

export type ExtraFieldsInfo = { fields: { fieldName: string; dataTypeId: number }[] };

export class BlobUploadTracker {
  byBlob = new Map<WebHareBlob, string>();
  byId = new Map<string, WebHareBlob>();
}

export type WHDBCodecContext = {
  uploadTracker?: BlobUploadTracker;
};

export interface WHDBClientInterface extends PoolClient {
  close(): Promise<void>;
  getRefObject(): { ref(): void; unref(): void };
  getBackendProcessId(): number | undefined;
  uploadTracker: BlobUploadTracker;
}

export type WHDBPgClientOptions = {
  /// Raw: use default PostgreSQL client without WHDB-specific configuration
  raw?: boolean;
  /// Callback invoked when the client is released
  onRelease?: (client: WHDBClientInterface) => void;
};
