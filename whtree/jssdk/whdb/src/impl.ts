/* WebHare database SQL driver
*/

import {
  sql,
  Kysely,
  PostgresDialect,
  type Expression,
  type PostgresPool,
  type PostgresCursor,
  type PostgresQueryResult,
  type Selectable as KSelectable,
  type Insertable as KInsertable,
  type Updateable as KUpdateable,
} from 'kysely';

import type { ReadableStream } from "node:stream/web";
import { type BackendEvent, type BackendEventData, broadcast, fenceEvents } from '@webhare/services/src/backendevents';
import type { WebHareBlob } from '@webhare/services/src/webhareblob';
import { type Mutex, lockMutex } from '@webhare/services/src/mutex.ts';
import { debugFlags } from '@webhare/env/src/envbackend';
import { __getBlobDatabaseId, __getBlobDiskFilePath, uploadBlobToConnection } from './blobs';
import { ensureScopedResource, getScopedResource, setScopedResource } from '@webhare/services/src/codecontexts';
import * as PostgreaseConnectionLib from './connection-postgrease';
import { KyselyInToAnyPlugin } from './kysely-transforms';
import type { BackendEvents } from '@webhare/services';
import { escapePGIdentifier } from './metadata';
import { isError, isPromise, sleep, type WaitPeriod } from '@webhare/std';
import type { PoolClient, WHDBClientInterface } from './connectionbase';
import type { PGPassthroughQueryCallback } from '@webhare/postgrease';

export const PGIsolationLevels = ["read committed", "repeatable read", "serializable"] as const;

/** Transaction options  */
export interface WorkOptions {
  /// Name of a mutex (or mutexes) to lock during the transaction
  mutex?: string | string[];
  /// PG Isolation level. "read committed" is the default
  isolationLevel?: typeof PGIsolationLevels[number];
  /// Read only transaction
  readOnly?: boolean;
  /// Use a snapshopt to use (isolation level must be repeatable read or serializable, using readOnly is recommended )
  useSnapshot?: string;

  __skipNameCheck?: boolean; //to allow HS mutex names
}

// A finish handler is invoked when a transaction is committed or rolled back.
export interface FinishHandler {
  /// Callback that is invoked before we attempt to commit
  onBeforeCommit?: () => unknown | Promise<unknown>;
  /// Callback that is invoked on a succesful commit
  onCommit?: () => unknown | Promise<unknown>;
  /// Callback that is invoked before we attempt to rollback
  onBeforeRollback?: () => unknown | Promise<unknown>;
  /// Callback that is invoked on a rollback
  onRollback?: () => unknown | Promise<unknown>;
  /** Callback that is invoked after all onBeforeXXX handlers have been called. Should be used for
   * gathering after-commit handlers only, not for doing any work.
   */
  onAfterPrepare?: () => unknown | Promise<unknown>;
  /** Callback that is invoked when the commit events should be emitted */
  onCommitEvents?: () => unknown | Promise<unknown>;
}

export class DBReadonlyError extends Error {
  constructor() {
    super("The database is in read-only mode");
  }
}

//not sure if we really want to expose Work as a usable object yet
export interface WorkObject extends AsyncDisposable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}


class Work implements WorkObject {
  conn;
  open;
  private finishhandlers = new Map<string | symbol, FinishHandler>;
  private commituniqueevents = new Set<string>;
  private commitdataevents: BackendEvent[] = [];
  private locks = new Array<Mutex>;

  constructor(conn: WHDBConnectionImpl, options?: WorkOptions) {
    this.conn = conn;
    this.open = true;
  }

  /* Gather and invoke finish handlers. These work on the current code context and are designed to invoke the handlers in the right order
     even when callback handlers open new work during their execution. Runs any precommit handlers immediately */
  private async prepareFinish(commit: boolean): Promise<void> {
    for (const h of this.finishhandlers.values())
      if (commit)
        await h.onBeforeCommit?.();
      else
        await h.onBeforeRollback?.();
    await Promise.all(Array.from(this.finishhandlers.values()).map(h => h.onAfterPrepare?.()));
  }

  private async invokeFinishHandlers(stage: "onCommit" | "onRollback") {
    //invoke all finishedhandlers serially (otherwise opening/closing work in different HSVM's might run parallel)
    for (const h of this.finishhandlers.values())
      if (stage === "onCommit")
        await h.onCommit?.();
      else if (stage === "onRollback")
        await h.onRollback?.();
  }

  async nextVals(field: string, howMany: number): Promise<number[]> {
    //TODO it's a bit weird for us to be blindly splitting and reeconding table names. but if we take separate schema and table names, we'd be incompatible with Kyseley?
    const fieldtoks = field.split('.');
    if (fieldtoks.length !== 3)
      throw new Error(`Invalid field name '${field}' - expecting <schema>.<table>.<column>${fieldtoks.length === 2 ? ", did you forget to add '.id' ?" : ""}`);

    const [schema, table, column] = fieldtoks;
    const generator = `(${escapePGIdentifier(schema)}.${escapePGIdentifier(`webhare_autonrs_${table}_${column}`)}(${howMany}))`;
    const queryresult = (await this.conn.query<{ value: number[] }>(`SELECT ${generator} AS value`));
    const result = queryresult.rows[0]?.value;
    if (result?.length !== howMany)
      throw new Error(`No value returned by autonr generator`);

    return result;
  }

  /** low level debug API to verify   */
  private getUploadedBlobId(data: WebHareBlob): string | undefined {
    return __getBlobDatabaseId(data) || this.conn.client?.uploadTracker.byBlob.get(data);
  }

  async uploadBlob(data: WebHareBlob | ReadableStream<Uint8Array>): Promise<WebHareBlob> {
    if (!this.open)
      throw new Error(`Work is already closed`);
    if (!this.conn.client)
      throw new Error(`Connection was already closed`);
    if (debugFlags["db-readonly"])
      throw new DBReadonlyError();
    if ("size" in data && (data.size === 0 || this.getUploadedBlobId(data))) //never need to upload a 0-byter or a blob we've already uploaded
      return data;

    const res = await uploadBlobToConnection(this.conn.client, data);
    if (res.pgBlobId) {
      this.conn.client.uploadTracker.byBlob.set(res.blob, res.pgBlobId);
      this.conn.client.uploadTracker.byId.set(res.pgBlobId, res.blob);
    }
    return res.blob;
  }

  async commit() {
    if (!this.open)
      throw new Error(`Work is already closed`);
    if (!this.conn.client)
      throw new Error(`Connection was already closed`);
    if (debugFlags["db-readonly"])
      throw new DBReadonlyError();

    //FIXME support readonly mode (if it stays?). HareScript solved it at this level, but perhaps we can move the problem to PG or the user we connect with ?
    try {
      await this.prepareFinish(true);
    } catch (e) {
      try {
        await this.rollback();
      } catch (ignore) {
        //TODO a rollback finish handler might throw but we can't deal with that. Ignore that for now
      }
      throw e;
    }

    this.open = false;
    try {
      const commitresult = await this.conn.client.query("COMMIT", []);
      if (commitresult.command as string !== "COMMIT")
        throw new Error(`Commit failed (usually due to earlier errors on this transaction)`);

      this.commituniqueevents.forEach(event => broadcast(event));
      this.commitdataevents.forEach(event => broadcast(event.name, event.data));
      for (const [databaseid, blob] of this.conn.client.uploadTracker.byId.entries()) {
        blob.setBlobPath(__getBlobDiskFilePath(databaseid));
      }
      const anyHandlerBroadcast = (await Promise.all(Array.from(this.finishhandlers.values()).map(h => h.onCommitEvents?.()))).some(_ => _);
      if (this.commitdataevents.length || this.commituniqueevents.size || anyHandlerBroadcast)
        await fenceEvents();
      this.clearWork();
      await this.invokeFinishHandlers("onCommit");
    } catch (e) {
      this.clearWork();
      await this.invokeFinishHandlers("onRollback");
      throw e;
    }
  }

  private clearWork() {
    this.__releaseMutexes();
    this.conn.openwork = undefined;
    if (this.conn.client) {
      this.conn.client.uploadTracker.byBlob = new Map;
      this.conn.client.uploadTracker.byId = new Map;
    }
  }

  hasMutex(m: string) {
    return this.locks.some(lock => lock.name === m);
  }

  async tryLockMutex(name: string, waitUntil: WaitPeriod, options?: { __skipNameCheck?: boolean }): Promise<boolean> {
    if (this.hasMutex(name))
      throw new Error(`Mutex ${JSON.stringify(name)} has already been locked by this session`);
    const lock = await lockMutex(name, { timeout: waitUntil, ...options });
    if (lock)
      this.locks.push(lock);
    return Boolean(lock);
  }

  addMutex(m: Mutex) {
    this.locks.push(m);
  }

  __releaseMutexes() {
    const locks = this.locks.slice(0, this.locks.length);
    locks.reverse().forEach(lock => lock.release());
  }

  async rollback() {
    if (!this.open)
      throw new Error(`Work is already closed`);
    if (!this.conn.client)
      throw new Error(`Connection was already closed`);

    await this.prepareFinish(false);
    this.open = false;
    try {
      await sql`ROLLBACK`.execute(this.conn._db);
      await this.invokeFinishHandlers("onRollback");
    } finally {
      this.clearWork();
    }
  }

  async [Symbol.asyncDispose]() {
    if (this.open)
      await this.rollback();
  }

  onFinish<T extends FinishHandler>(handler: T | (() => T), options?: { uniqueTag?: string | symbol }): T {
    if (!this.open)
      throw new Error(`Work is already closed`);

    const tag = options?.uniqueTag ?? Symbol("whdbUntaggedFinishHandler");
    let registeredhandler = this.finishhandlers.get(tag);
    if (!registeredhandler) {
      registeredhandler = typeof handler === "function" ? handler() : handler;
      this.finishhandlers.set(tag, registeredhandler);
    }
    return registeredhandler as T;
  }

  broadcastOnCommit(event: string, data?: BackendEventData): void {
    if (!this.open)
      throw new Error(`Work is already closed`);

    if (data)
      this.commitdataevents.push({ name: event, data });
    else
      this.commituniqueevents.add(event);
  }
}

class WHDBPostgresPool implements PostgresPool {
  conn: WHDBConnectionImpl;

  constructor(conn: WHDBConnectionImpl) {
    this.conn = conn;
  }

  async connect(): Promise<PoolClient> {
    return this.conn.waitConnected();
  }

  async end() {
  }
}

/** The WHDBConnectionImpl contains its own kysely PostgresPool, so we can take over connection handling.
 *  pg-pool has a timeout of a few seconds when the script ends, don't want that.
 *
 * Every WHDBConnection uses one pgclient, and runs all the queries over that transaction, so
 * no pooling is used within one connection.
    @typeParam T - Kysely database definition interface
*/
export class WHDBConnectionImpl implements WHDBConnection {
  pool;
  connected: boolean;
  _db;
  openwork?: Work;
  openingwork = false;
  lastopen?: Error;
  client?: WHDBClientInterface;
  clientPromise?: Promise<WHDBClientInterface>;

  constructor() {
    this.pool = new WHDBPostgresPool(this);
    this.connected = false;
    this._db = this.buildKyselyClient();
  }

  buildKyselyClient() {
    return new Kysely<unknown>({
      // PostgresDialect requires the Cursor dependency
      dialect: new PostgresDialect({
        pool: this.pool,
      }),
      plugins: [new KyselyInToAnyPlugin],
    });
  }

  waitConnected(): WHDBClientInterface | Promise<WHDBClientInterface> {
    const client = this.client ?? this.getPoolClient();
    if (isPromise(client))
      return client.then(promisedClient => {
        if (!promisedClient)
          throw new Error(`Connection was already closed`);
        return promisedClient;
      });
    if (!client)
      throw new Error(`Connection was already closed`);
    return client;
  }

  private getPoolClient(): WHDBClientInterface | undefined | Promise<WHDBClientInterface | undefined> {
    if (!this.connected) {
      this.clientPromise ??= (async () => {
        const client = await PostgreaseConnectionLib.createConnection();
        this.connected = true;
        this.client = client;
        return client;
      })();
      // don't return client from promise, but client from var - which is cleared when connection is closed
      return this.clientPromise.then(() => this.client);
    }
    return this.client;
  }

  async execute(command: string) {
    const client = await this.waitConnected();
    return await client.query(command, []);
  }

  query<R extends object>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R extends object>(sqlquery: string, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>>;

  query<R extends object>(sqlquery: string | PostgresCursor<R>, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof sqlquery !== "string")
      throw new Error(`Cursors are not supported on WHDBConnection`);

    const client = this.waitConnected();
    return isPromise(client) ?
      client.then(c => c.query<R>(sqlquery, parameters || [])) :
      client.query<R>(sqlquery, parameters || []);
  }

  async cancelQuery() {
    // No need to wait for a connection, no connections means no queries issued yet
    await this.client?.cancelQuery();
  }

  /** kysely query builder */
  db<T>(): Kysely<T> {
    /* Convert the type, the types don't influence the underlying implementation anyway */
    return this._db as Kysely<T>;
  }

  isWorkOpen() {
    return this.openwork?.open || false;
  }

  hasMutex(mutex: string) {
    return this.openwork?.hasMutex(mutex) || false;
  }

  tryLockMutex(name: string, waitUntil: WaitPeriod, options?: { __skipNameCheck?: boolean }): Promise<boolean> {
    return this.openwork?.tryLockMutex(name, waitUntil, options) ?? Promise.resolve(false);
  }

  private checkState(expectwork: true): Work; //guaranteed to return a work object or throw
  private checkState(expectwork: false): null; //guaranteed to return null or throw
  private checkState(expectwork: undefined): Work | null;

  private checkState(expectwork: boolean | undefined): Work | null {
    // Check work first - if work is open the connection must have been connected at some point, so no 'connection closed' error will be thrown during connecting
    if (expectwork !== undefined && (this.isWorkOpen() || this.openingwork) !== expectwork) {
      throw new Error(`Work has already been ${expectwork ? 'closed' : 'opened'}${debugFlags.async ? "" : " - WEBHARE_DEBUG=async may help locating this"}`, { cause: this.lastopen });
    }
    if (!this.client)
      throw new Error(`Connection was already closed`);
    return this.openwork || null;
  }

  async beginWork(options?: WorkOptions): Promise<WorkObject> {
    if (options?.isolationLevel && !PGIsolationLevels.includes(options.isolationLevel))
      throw new Error(`Invalid isolation level ${options.isolationLevel}`);
    if (options?.useSnapshot) {
      if (options?.isolationLevel !== "repeatable read" && options?.isolationLevel !== "serializable")
        throw new Error(`When using a snapshot, isolation level must be "repeatable read" or "serializable"`);
      if (options.useSnapshot.match(/[^0-9a-fA-F-]$/))
        throw new Error(`Invalid snapshot ID format`);
    }

    await this.waitConnected();

    let mutexes: Mutex[] | undefined = [];
    let newwork;
    let lastopen: Error | undefined;

    if (debugFlags.async)
      lastopen = new Error(`Work was last opened here`); //We must grab the stack before the first await

    try {
      if (options?.mutex)
        for (const name of Array.isArray(options.mutex) ? options.mutex : [options.mutex])
          mutexes.push(await lockMutex(name, { __skipNameCheck: options.__skipNameCheck }));
      if (debugFlags["db-readonly"])
        throw new DBReadonlyError();

      this.checkState(false); //we must have the mutexes before checking work state otherwise code can't protect itself using the lock

      this.openingwork = true;
      newwork = new Work(this);
      for (const mutex of mutexes)
        newwork.addMutex(mutex);
      mutexes = undefined;

      if (debugFlags.async)
        this.lastopen = lastopen;

      const isolationLevel = options?.isolationLevel ?? "read committed";
      await this.execute(`START TRANSACTION ISOLATION LEVEL ${isolationLevel} ${options?.readOnly ? "READ ONLY" : "READ WRITE"}`);
      if (options?.useSnapshot) {
        await this.execute(`SET TRANSACTION SNAPSHOT '${options.useSnapshot}'`);
      }
    } catch (e) {
      newwork?.__releaseMutexes();
      if (mutexes)
        mutexes.forEach(m => m.release());
      throw e;
    } finally {
      this.openingwork = false;
    }

    this.openwork = newwork;
    return this.openwork;
  }

  async nextVal(table: string): Promise<number> {
    return this.nextVals(table, 1).then(_ => _[0]);
  }

  async nextVals(table: string, howMany: number): Promise<number[]> {
    return await this.checkState(true).nextVals(table, howMany);
  }

  async commitWork(): Promise<void> {
    return this.checkState(true).commit();
  }

  async rollbackWork(): Promise<void> {
    return this.checkState(true).rollback();
  }

  async uploadBlob(data: WebHareBlob | ReadableStream<Uint8Array>): Promise<WebHareBlob> {
    return this.checkState(true).uploadBlob(data);
  }

  onFinishWork<T extends FinishHandler>(handler: T | (() => T), options?: { uniqueTag?: string | symbol }): T {
    return this.checkState(true).onFinish(handler, options);
  }

  broadcastOnCommit(event: string, data?: BackendEventData) {
    this.checkState(true).broadcastOnCommit(event, data);
  }

  passthroughQuery(query: Buffer | AsyncIterable<Buffer>, callback: PGPassthroughQueryCallback): void {
    if (debugFlags["usepostgrejs"])
      throw new Error(`passthroughQuery is not supported with postgrejs driver`);
    const client = this.waitConnected();
    if (!isPromise(client))
      client.passthroughQuery(query, callback);
    else void client.then(c => {
      c.passthroughQuery(query, callback);
    }, e => callback(e));
  }

  async close() {
    if (this.client)
      await this.client.close();
    else if (this.clientPromise) {
      void this.clientPromise.then(async client => {
        this.client = undefined;
        await client.close();
      });
    }
    this.client = undefined;
  }

  async __getConfiguration() {
    const client = await this.waitConnected();
    return {
      ...PostgreaseConnectionLib.__getConfiguration(),
      backendPid: client.getBackendProcessId() ?? 0,
    };
  }
}

/** A database connection
    @typeParam T - Kysely database definition interface
*/

export type WHDBConnection = Pick<WHDBConnectionImpl, "db" | "beginWork" | "commitWork" | "rollbackWork" | "isWorkOpen" | "hasMutex" | "tryLockMutex" | "onFinishWork" | "broadcastOnCommit" | "uploadBlob" | "nextVal" | "nextVals" | "passthroughQuery" | "cancelQuery">;

const connsymbol = Symbol("WHDBConnection");
const workqueuesymbol = Symbol("WorkQueueSymbol");

export function getConnection(): WHDBConnection {
  return ensureScopedResource(connsymbol, () => new WHDBConnectionImpl, async (conn) => {
    if (conn.isWorkOpen())
      await conn.rollbackWork();

    return await conn.close();
  });
}

/** Stash the current work object, opening a new connection (with potential new work) */
export function stashWork() {
  const conn = getScopedResource<WHDBConnectionImpl>(connsymbol);
  const stack = ensureScopedResource<Array<WHDBConnectionImpl | undefined>>(workqueuesymbol, () => new Array<WHDBConnectionImpl>, async (curstack) => {
    for (const c of curstack)
      await c?.close();
  });
  stack.push(conn);
  setScopedResource(connsymbol, undefined);
}

export async function popWork() {
  const stack = getScopedResource<Array<WHDBConnectionImpl | undefined>>(workqueuesymbol);
  if (!stack?.length)
    throw new Error(`No work to pop`);

  const oldconn = getScopedResource<WHDBConnectionImpl>(connsymbol);
  setScopedResource(connsymbol, stack.pop());
  if (oldconn)
    await oldconn.close();
}

/* db<T> is defined as a function so a call is made every time it is accessed.
   We're just returning the conn.db (with a typecast, but that is transpiled away),
   so very low cost. With this kind of interface, it is easy to type-cast with the
   required database definition for the client, and the implementation to dispatch
   to the right VM context, when those are introduced.

/** Get a SQL query builder for the default database connection for this context.
    @typeParam T Kysely database definition
*/
export function db<T>() {
  return getConnection().db<T>();
}

// Error codes that trigger retry: https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html
const retryableErrorCodes: Array<string | undefined> = [
  "40001",  // serialization failure
  "40P01", // deadlock detected
];

/** Run a function inside work and commit it
 * @throws If the function throws, the work is rolled back and the exception is rethrown
 */
export async function runInWork<T>(func: () => T | Promise<T>, options?: WorkOptions & { autoRetry?: boolean; maxRetries?: number }): Promise<T> {
  const maxRetries = options?.maxRetries ?? 10;
  for (let tryCount = 1; ; ++tryCount) {
    await beginWork(options);
    try {
      const retval = await func();
      await commitWork();
      return retval;
    } catch (e) {
      if (isWorkOpen())
        await rollbackWork();

      if (!options?.autoRetry || tryCount >= maxRetries || !isDatabaseError(e) || !retryableErrorCodes.includes(e.code || ""))
        throw e;
      const backupConst = Math.log(100) / 8; // Exponential increase to 100ms in try 8
      await sleep(Math.min(100, Math.exp(tryCount * backupConst)) * (Math.random() + 0.5)); // Max base out at 100ms, then add [ -50%, +50% ] jitter
    }
  }
}


/** Run a function in a separate work object and commit it
 * @throws If the function throws, the work is rolled back and the exception is rethrown
 */
export async function runInSeparateWork<T>(func: () => T | Promise<T>, options?: WorkOptions): Promise<T> {
  stashWork();
  try {
    await using work = await beginWork(options);
    void (work);

    const retval = await func();
    await commitWork();
    return retval;
  } finally {
    await popWork();
  }
}

/** Returns whether work is currently open
    @returns `true` if work is open, `false` if not.
*/
export function isWorkOpen() {
  return getConnection().isWorkOpen();
}

/** Is the specified mutex locked by the current work?
    @returns `true` if the mutex is locked
*/
export function workHasMutex(mutex: string) {
  return getConnection().hasMutex(mutex);
}

export function tryLockMutex(mutex: string, waitUntil: Date | Temporal.Instant, options?: { __skipNameCheck?: boolean }): Promise<boolean> {
  return getConnection().tryLockMutex(mutex, waitUntil, options);
}

/** Get the next primary key value for a specific column
 * @param column - Column to get the next value for, in the format `<schema>.<table>.<column>`
*/
export function nextVal(column: string) {
  return getConnection().nextVal(column);
}

/** Get multiple primary key values for a specific column
 * @param column - Column to get the next values for, in the format `<schema>.<table>.<column>`
 * @param howMany - How many values to get
*/
export function nextVals(column: string, howMany: number) {
  return getConnection().nextVals(column, howMany);
}

/** Begins a new transaction. Throws when a transaction is already in progress
 * @returns An AsyncDisposable work object that can be used with 'await using' to automatically rollback the work if not yet committed
*/
export function beginWork(options?: WorkOptions): Promise<WorkObject> {
  return getConnection().beginWork(options);
}

/** Commits the current transaction
*/
export function commitWork() {
  return getConnection().commitWork();
}

export function query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
export function query<R>(sqlquery: string, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>>;

export function query<R>(sqlquery: string | PostgresCursor<R>, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
  ///@ts-ignore -- We don't really care about the arguments, just delegating it to the actual implementation
  return getConnection().query<R>(sqlquery, parameters);
}

/** Rollbacks the transaction
*/
export function rollbackWork() {
  return getConnection().rollbackWork();
}

/** Upload a blob to the database
 *  @returns Uploaded version of the blob. If the blob was uploaded earlier, the same WHDBBlob is returned
*/
export async function uploadBlob(data: WebHareBlob | ReadableStream<Uint8Array>): Promise<WebHareBlob> {
  return getConnection().uploadBlob(data);
}

/** Register a finish hander for the current work with the specified tag
 * @typeParam T - Type of the handler to register.
 * @param handler - Handler to register. If a function is passed, it is called to get the handler. Ignored if a handler is already present
 * @param options - uniqueTag: Unique tag to register the handler with. If a handler is already registered with this tag, it is replaced.
 * @returns The newly registerd handler. If uniqueTag is set, the originally registered handler is returned
*/
export function onFinishWork<T extends FinishHandler>(handler: T | (() => T), options?: { uniqueTag?: string | symbol }): T {
  return getConnection().onFinishWork(handler, options);
}

/** Broadcast event on a succesful commit */
export function broadcastOnCommit<EventName extends keyof BackendEvents>(event: EventName, data: BackendEvents[EventName]): void;
export function broadcastOnCommit<EventName extends keyof BackendEvents>(event: EventName & (BackendEvents[EventName] extends null ? string : "Event requires parameter")): void;
export function broadcastOnCommit<EventName extends string>(event: EventName & (EventName extends keyof BackendEvents ? "Event requires parameter" : string), data?: BackendEventData): void;
export function broadcastOnCommit<EventName extends string>(event: EventName & (EventName extends keyof BackendEvents ? "Event requires parameter" : string)): void;

export function broadcastOnCommit(event: string, data?: BackendEventData) {
  getConnection().broadcastOnCommit(event, data);
}

export function finishHandlerFactory<T extends FinishHandler>(obj: new () => T): () => T {
  const symbol = Symbol(`onFinishWork: ${obj.name}`);
  return () => onFinishWork(() => new obj, { uniqueTag: symbol });
}

/** Get a new, indepedent database connection.
*/
export function __getNewConnection(): WHDBConnection {
  return new WHDBConnectionImpl();
}

export function __passthroughQuery(queryPackets: Buffer | AsyncIterable<Buffer>, callback: PGPassthroughQueryCallback): void {
  getConnection().passthroughQuery(queryPackets, callback);
}

/** Get a new raw database connection (without codecs for dynamically created types like blobs)
 */
export function __createRawConnection(): Promise<WHDBClientInterface> {
  return PostgreaseConnectionLib.createConnection({ raw: true });
}

export function isDatabaseError(e: unknown): e is InstanceType<typeof PostgreaseConnectionLib["DatabaseError"]> {
  return isError(e) && e instanceof PostgreaseConnectionLib.DatabaseError;
}

interface NoTable {
  none: boolean;
}

type AllowedKeys<Q> = Q extends Kysely<infer DB> ? keyof DB : Q extends object ? keyof Q : NoTable;

/** Converts a table of a Kysely database definition to the type of the data returned by SELECT queries.
    @typeParam Q - Either
    - Database definition (eg `PlatformDB`)
    - Type of the Kysely instance (eq `typeof db<PlatformDB>`)
    - Table definition to convert (eq `PlatformDB["WRD_Entities"]`)
    @typeParam S - Table to select from a database definition or Kysely instance
    @example
```
// The following three types all describe the data returned from SELECT * FROM wrd.entities:
type WRDEntitiesSelect = Selectable<PlatformDB, "wrd.entities">;
const mydb = db<PlatformDB>();
type WRDEntitiesSelect2 = Selectable<typeof mydb, "wrd.entities">;
type WRDEntitiesSelect3 = Selectable<PlatformDB["wrd.entities"]>;

const rows: WRDEntitiesUpdate[] = await db<PlatformDB>().selectFrom("wrd.entities").selectAll().execute();
```
*/
export type Selectable<Q, S extends AllowedKeys<Q> = AllowedKeys<Q> & NoTable> = S extends NoTable ? KSelectable<Q> : Q extends Kysely<infer DB> ? S extends keyof DB ? KSelectable<DB[S]> : never : S extends keyof Q ? KSelectable<Q[S]> : never;

/** Converts a Kysely database definition (or type of the Kysely client returned by db()) to the type of the data that can be updated in that table
    @typeParam Q - Either
    - Database definition (eg `PlatformDB`)
    - Type of the Kysely instance (eq `typeof db<PlatformDB>`)
    - Table definition to convert (eq `PlatformDB["WRD_Entities"]`)
    @typeParam S - Table to select from a database definition or Kysely instance
    @example
```
// The following three types all describe the data that can be updated in the wrd.entities table:
type WRDEntitiesUpdate = Updateable<PlatformDB, "wrd.entities">;
const mydb = db<PlatformDB>();
type WRDEntitiesUpdate2 = Updateable<typeof mydb, "wrd.entities">;
type WRDEntitiesUpdate3 = Updateable<PlatformDB["wrd.entities"]>;

const updates: WRDEntitiesUpdate = { ... };
const id: number = ...;
await db<PlatformDB>().updateTable("wrd.entities").where("id", "=", id).set(updates).execute();
```
*/
export type Updateable<Q, S extends AllowedKeys<Q> = AllowedKeys<Q> & NoTable> = S extends NoTable ? KUpdateable<Q> : Q extends Kysely<infer DB> ? S extends keyof DB ? KUpdateable<DB[S]> : never : S extends keyof Q ? KUpdateable<Q[S]> : never;

/** Converts a Kysely database definition (or type of the Kysely client returned by db()) to the type of the data that can be inserted into that table
    @typeParam Q - Either
    - Database definition (eg `PlatformDB`)
    - Type of the Kysely instance (eq `typeof db<PlatformDB>`)
    - Table definition to convert (eq `PlatformDB["WRD_Entities"]`)
    @typeParam S - Table to select from a database definition or Kysely instance
    @example
```
// The following three types all describe the data that can be inserted into the wrd.entities table:
type WRDEntitiesInserts = Insertable<PlatformDB, "wrd.entities">;
const mydb = db<PlatformDB>();
type WRDEntitiesInserts2 = Insertable<typeof mydb, "wrd.entities">;
type WRDEntitiesInserts3 = Insertable<PlatformDB["wrd.entities"]>;

const values: WRDEntitiesInserts = { ... };
db<PlatformDB>().insertInto("wrd.entities").values(values).execute();
```
*/
export type Insertable<Q, S extends AllowedKeys<Q> = AllowedKeys<Q> & NoTable> = S extends NoTable ? KInsertable<Q> : Q extends Kysely<infer DB> ? S extends keyof DB ? KInsertable<DB[S]> : never : S extends keyof Q ? KInsertable<Q[S]> : never;

type Bindables = {
  uuid: [string, string];
  timestamptz: [Temporal.Instant | Temporal.ZonedDateTime | number, Temporal.Instant];
  float8: [number, number];
};

/** Overrides the type of a value for use in Kysely expressions (not all types are auto-detected, like UUID's
 * or (+/-)Infinity for timestamps)
 * @param value - Value
 * @param type - 'Real' type of the value (to send to PostgreSQL)
 * @returns An expression that can be used in SQL queries
*/
export function overrideValueType<T extends keyof Bindables>(value: Bindables[T][0], type: T): Expression<Bindables[T][1]> {
  return sql`${PostgreaseConnectionLib.pgBindParam(value, type)}`;
}

/** Overrides the type of a value for arguments of query() (not all types are auto-detected, like UUID's or (+/-)Infinity for timestamps)
 * @param value - Value
 * @param type - 'Real' type of the value (to send to PostgreSQL)
 * @returns The value wrapped in an objects that forces the encoding of that value to the specified type when used as argument to  query().
*/
export function overrideQueryArgType<T extends keyof Bindables>(value: Bindables[T][0], type: T): unknown {
  return PostgreaseConnectionLib.pgBindParam(value, type);
}
