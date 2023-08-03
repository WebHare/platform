import {
  PostgresCursor,
  PostgresQueryResult,
} from 'kysely';
import { Client, Connection } from 'pg';

// Needed to access the postgesql client connection for ref/unref
interface ClientWithConnection extends Client {
  connection: Connection;
}

export class WHDBPgClient {
  pgclient?;
  connected = false;

  constructor() {
    this.pgclient = new Client({
      host: process.env.WEBHARE_DATAROOT + "/postgresql",
      database: process.env.WEBHARE_DBASENAME
    }) as ClientWithConnection;
  }

  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(sqlquery: string, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>>;

  query<R>(sqlquery: string | PostgresCursor<R>, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof sqlquery === "string") {
      if (!this.pgclient)
        throw new Error(`Connection was already closed`);

      return this.pgclient.query(sqlquery, parameters as unknown[]) as unknown as Promise<PostgresQueryResult<R>>;
    }
    // FIXME: see if our Cursor implementation is correct
    return sqlquery;
  }

  /// Allocates a PostgresPoolClient
  async connect(): Promise<WHDBPgClient> {
    if (!this.connected) {
      if (!this.pgclient)
        throw new Error(`Connection was already closed`);

      await this.pgclient.connect();
      this.connected = true;
    }
    return this;
  }

  close() {
    this.pgclient?.end();
    this.pgclient = undefined;
  }
}
