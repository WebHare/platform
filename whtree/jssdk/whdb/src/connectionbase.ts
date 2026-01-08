import type {
  PostgresPoolClient,
} from 'kysely';

export type ExtraFieldsInfo = { fields: { fieldName: string; dataTypeId: number }[] };

export interface WHDBClientInterface extends PostgresPoolClient {
  close(): Promise<void>;
  getRefObject(): { ref(): void; unref(): void };
  getBackendProcessId(): number | undefined;
}

export type WHDBPgClientOptions = {
  /// Raw: use default PostgreSQL client without WHDB-specific configuration
  raw?: boolean;
  /// Callback invoked when the client is released
  onRelease?: (client: WHDBClientInterface) => void;
};
