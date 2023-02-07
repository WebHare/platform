/* WebHare database SQL driver
*/
import {
  sql,
  Kysely,
  PostgresDialect,
  PostgresPool,
  PostgresPoolClient,
  PostgresCursor,
  PostgresQueryResult,
  Selectable as KSelectable,
  Insertable as KInsertable,
  Updateable as KUpdateable,
} from 'kysely';
import { Client, Connection } from 'pg';
import { RefTracker, checkIsRefCounted } from '@mod-system/js/internal/whmanager/refs';
//import { setTimeout } from 'timers';

// Export kysely helper stuff for use in external modules
export {
  sql,
  ColumnType,
  Generated,
  GeneratedAlways,
} from "kysely";

// Needed to access the postgesql client connection for ref/unref
interface ClientWithConnection extends Client {
  connection: Connection;
}

class Work {
  conn;
  open;

  constructor(conn: WHDBConnectionImpl) {
    this.conn = conn;
    this.open = true;
  }

  async commit() {
    if (!this.open)
      throw new Error(`Work is already closed`);
    if (!this.conn.pgclient)
      throw new Error(`Connection was already closed`);

    this.open = false;
    const lock = this.conn.reftracker.getLock("query lock: COMMIT");
    try {
      await sql`COMMIT`.execute(this.conn._db);
    } finally {
      lock.release();
      this.conn.openwork = undefined;
    }
  }

  async rollback() {
    if (!this.open)
      throw new Error(`Work is already closed`);
    if (!this.conn.pgclient)
      throw new Error(`Connection was already closed`);

    this.open = false;
    const lock = this.conn.reftracker.getLock("query lock: ROLLBACK");
    try {
      await sql`ROLLBACK`.execute(this.conn._db);
    } finally {
      lock.release();
      this.conn.openwork = undefined;
    }
  }
}

/** A database connection
    @typeParam T - Kysely database definition interface
*/

interface WHDBConnection {
  /** kysely query builder */
  db<T>(): Kysely<T>;
  beginWork(): Promise<void>;
  commitWork(): Promise<void>;
  rollbackWork(): Promise<void>;
  isWorkOpen(): boolean;
}

/* Every WHDBConnection uses one pgclient, and runs all the queries over that transaction, so
   no pooling is used within one connection.
*/

/** The WHDBConnectionImpl implements the kysely PostgresPool and PostgresPoolClient interfaces,
    so we can take over connection handling. pg-pool has a timeout of a few seconds when the
    script ends, don't want that.
    @typeParam T - Kysely database definition interface
*/
class WHDBConnectionImpl implements WHDBConnection, PostgresPool, PostgresPoolClient {
  _db;
  pgclient?;
  reftracker;
  openwork?: Work;
  connected = false;

  constructor() {
    this.pgclient = new Client({
      host: process.env.WEBHARE_DATAROOT + "/postgresql",
      database: process.env.WEBHARE_DBASENAME
    }) as ClientWithConnection;
    this._db = this.buildKyselyClient();
    this.reftracker = new RefTracker(checkIsRefCounted(this.pgclient.connection.stream), { initialref: true });
    this.reftracker.dropInitialReference();
  }

  buildKyselyClient() {
    return new Kysely<unknown>({
      // PostgresDialect requires the Cursor dependency
      dialect: new PostgresDialect({
        pool: this
      })
    });
  }

  /// Allocates a PostgresPoolClient
  async connect(): Promise<WHDBConnectionImpl> {
    if (!this.connected) {
      if (!this.pgclient)
        throw new Error(`Connection was already closed`);
      const lock = this.reftracker.getLock("connect lock");
      try {
        await this.pgclient.connect();
        this.connected = true;
      } finally {
        lock.release();
      }
    }
    return this;
  }

  async end() {
    // is needed for PostgresPool implementation
  }

  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(sqlquery: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<R>>;

  query<R>(sqlquery: string | PostgresCursor<R>, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof sqlquery === "string") {
      if (!this.pgclient)
        throw new Error(`Connection was already closed`);
      const lock = this.reftracker.getLock("query lock");
      return this.pgclient.query(sqlquery, parameters as unknown[]).finally(() => lock.release()) as unknown as Promise<PostgresQueryResult<R>>;
    }
    // FIXME: see if our Cursor implementation is correct
    return sqlquery;
  }

  /// Releases the PostgresPoolClient
  async release() {
    //
  }

  db<T>(): Kysely<T> {
    /* Convert the type, the types don't influence the underlying implementation anyway */
    return this._db as Kysely<T>;
  }

  isWorkOpen() {
    return Boolean(this.openwork);
  }

  async beginWork(): Promise<void> {
    if (!this.pgclient)
      throw new Error(`Connection was already closed`);
    if (this.openwork)
      throw new Error(`Work has already been opened`);

    const lock = this.reftracker.getLock("work lock");
    this.openwork = new Work(this);
    try {
      await sql`START TRANSACTION ISOLATION LEVEL read committed READ WRITE`.execute(this._db);
      //      this.pgclient.query("START TRANSACTION ISOLATION LEVEL read committed READ WRITE");
    } catch (e) {
      this.openwork = undefined;
      throw e;
    } finally {
      lock.release();
    }
  }

  async commitWork(): Promise<void> {
    if (!this.pgclient)
      throw new Error(`Connection was already closed`);
    if (!this.openwork)
      throw new Error(`Work has already been closed`);

    await this.openwork.commit();
  }

  async rollbackWork(): Promise<void> {
    if (!this.pgclient)
      throw new Error(`Connection was already closed`);
    if (!this.openwork)
      throw new Error(`Work has already been closed`);

    await this.openwork.rollback();
  }

  close() {
    this.pgclient?.end();
    this.pgclient = undefined;
  }
}

const conn: WHDBConnection = new WHDBConnectionImpl();

/* db<T> is defined as a function so a call is made every time it is accessed.
   We're just returning the conn.db (with a typecast, but that is transpiled away),
   so very low cost. With this kind of interface, it is easy to type-cast with the
   required database definition for the client, and the implementation to dispatch
   to the right VM context, when those are introduced.

/** Get a SQL query builder for the default database connection for this context.
    @typeParam T Kysely database definition
*/
export function db<T>() {
  return conn.db<T>();
}

/** Returns whether work is currently open
    @returns `true` if work is open, `false` if not.
*/
export function isWorkOpen() {
  return conn.isWorkOpen();
}

/** Begins a new transaction. Throws when a transaction is already in progress
*/
export async function beginWork() {
  await conn.beginWork();
}

/** Commits the current transaction
*/
export async function commitWork() {
  await conn.commitWork();
}

/** Rollbacks the transaction
*/
export async function rollbackWork() {
  await conn.rollbackWork();
}

/** Get a new, indepedent database connection.
*/
export function __getNewConnection(): WHDBConnection {
  return new WHDBConnectionImpl();
}

interface NoTable {
  none: boolean;
}

type AllowedKeys<Q> = Q extends Kysely<infer DB> ? keyof DB : Q extends object ? keyof Q : NoTable;

/** Converts a table of a Kysely database definition to the type of the data returned by SELECT queries.
    @typeParam Q - Either
    - Database definition (eg `WebhareDB`)
    - Type of the Kysely instance (eq `typeof db<WebhareDB>`)
    - Table definition to convert (eq `WebhareDB["WRD_Entities"]`)
    @typeParam S - Table to select from a database definition or Kysely instance
    @example
```
// The following three types all describe the data returned from SELECT * FROM wrd.entities:
type WRDEntitiesSelect = Selectable<WebhareDB, "wrd.entities">;
const mydb = db<WebhareDB>();
type WRDEntitiesSelect2 = Selectable<typeof mydb, "wrd.entities">;
type WRDEntitiesSelect3 = Selectable<WebhareDB["wrd.entities"]>;

const rows: WRDEntitiesUpdate[] = await  db<WebhareDB>().selectFrom("wrd.entities").selectAll().execute();
```
*/
export type Selectable<Q, S extends AllowedKeys<Q> = AllowedKeys<Q> & NoTable> = S extends NoTable ? KSelectable<Q> : Q extends Kysely<infer DB> ? S extends keyof DB ? KSelectable<DB[S]> : never : S extends keyof Q ? KSelectable<Q[S]> : never;

/** Converts a Kysely database definition (or type of the Kysely client returned by db()) to the type of the data that can be updated in that table
    @typeParam Q - Either
    - Database definition (eg `WebhareDB`)
    - Type of the Kysely instance (eq `typeof db<WebhareDB>`)
    - Table definition to convert (eq `WebhareDB["WRD_Entities"]`)
    @typeParam S - Table to select from a database definition or Kysely instance
    @example
```
// The following three types all describe the data that can be updated in the wrd.entities table:
type WRDEntitiesUpdate = Updateable<WebhareDB, "wrd.entities">;
const mydb = db<WebhareDB>();
type WRDEntitiesUpdate2 = Updateable<typeof mydb, "wrd.entities">;
type WRDEntitiesUpdate3 = Updateable<WebhareDB["wrd.entities"]>;

const updates: WRDEntitiesUpdate = { ... };
const id: number = ...;
await db<WebhareDB>().updateTable("wrd.entities").where("id", "=", id).set(updates).execute();
```
*/
export type Updateable<Q, S extends AllowedKeys<Q> = AllowedKeys<Q> & NoTable> = S extends NoTable ? KUpdateable<Q> : Q extends Kysely<infer DB> ? S extends keyof DB ? KUpdateable<DB[S]> : never : S extends keyof Q ? KUpdateable<Q[S]> : never;

/** Converts a Kysely database definition (or type of the Kysely client returned by db()) to the type of the data that can be inserted into that table
    @typeParam Q - Either
    - Database definition (eg `WebhareDB`)
    - Type of the Kysely instance (eq `typeof db<WebhareDB>`)
    - Table definition to convert (eq `WebhareDB["WRD_Entities"]`)
    @typeParam S - Table to select from a database definition or Kysely instance
    @example
```
// The following three types all describe the data that can be inserted into the wrd.entities table:
type WRDEntitiesInserts = Insertable<WebhareDB, "wrd.entities">;
const mydb = db<WebhareDB>();
type WRDEntitiesInserts2 = Insertable<typeof mydb, "wrd.entities">;
type WRDEntitiesInserts3 = Insertable<WebhareDB["wrd.entities"]>;

const values: WRDEntitiesInserts = { ... };
db<WebhareDB>().insertInto("wrd.entities").values(values).execute();
```
*/
export type Insertable<Q, S extends AllowedKeys<Q> = AllowedKeys<Q> & NoTable> = S extends NoTable ? KInsertable<Q> : Q extends Kysely<infer DB> ? S extends keyof DB ? KInsertable<DB[S]> : never : S extends keyof Q ? KInsertable<Q[S]> : never;
