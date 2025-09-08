/* WebHare database SQL driver
*/

import {
  sql,
  Kysely,
  PostgresDialect,
  type PostgresPool,
  type PostgresPoolClient,
  type PostgresCursor,
  type PostgresQueryResult,
  type Selectable as KSelectable,
  type Insertable as KInsertable,
  type Updateable as KUpdateable,
} from 'kysely';

import type { ReadableStream } from "node:stream/web";
import { RefTracker, checkIsRefCounted } from '@mod-system/js/internal/whmanager/refs';
import { type BackendEvent, type BackendEventData, broadcast } from '@webhare/services/src/backendevents';
import type { WebHareBlob } from '@webhare/services/src/webhareblob';
import { type Mutex, lockMutex } from '@webhare/services/src/mutex.ts';
import { debugFlags } from '@webhare/env/src/envbackend';
import { uploadBlobToConnection } from './blobs';
import { ensureScopedResource, getScopedResource, setScopedResource } from '@webhare/services/src/codecontexts';
import { WHDBPgClient } from './connection';
import { type HareScriptVM, getActiveVMs } from '@webhare/harescript/src/wasm-hsvm';
import type { HSVMHeapVar } from '@webhare/harescript/src/wasm-hsvmvar';
import { KyselyInToAnyPlugin } from './kysely-transforms';
import type { BackendEvents } from '@webhare/services';
import { escapePGIdentifier } from './metadata';
import { isError, sleep } from '@webhare/std';
import { DatabaseError } from '../vendor/postgrejs/src';

export const PGIsolationLevels = ["read committed", "repeatable read", "serializable"] as const;

/** Transaction options  */
export interface WorkOptions {
  /// Name of a mutex (or mutexes) to lock during the transaction
  mutex?: string | string[];
  /// PG Isolation level. "read committed" is the default
  isolationLevel?: typeof PGIsolationLevels[number];
}

// A finish handler is invoked when a transaction is committed or rolled back.
export interface FinishHandler {
  /// Callback that is invoked before we attempt to commit
  onBeforeCommit?: () => unknown | Promise<unknown>;
  /// Callback that is invoked on a succesful commit
  onCommit?: () => unknown | Promise<unknown>;
  /// Callback that is invoked on a rollback
  onRollback?: () => unknown | Promise<unknown>;
}

export class DBReadonlyError extends Error {
  constructor() {
    super("The database is in read-only mode");
  }
}

class HandlerList implements Disposable {
  handlerlist = new Array<{
    vm: HareScriptVM;
    handlers: HSVMHeapVar;
  }>();

  async setup(iscommit: boolean) {
    for (const vm of getActiveVMs()) {  //someone allocated a VM.. run any handlers there too
      const handlers = vm.allocateVariable();
      using commitparam = vm.allocateVariable();
      commitparam.setBoolean(iscommit);

      //This also invokes precommit handlers for that VM
      await vm.callWithHSVMVars("wh::internal/transbase.whlib#__PopPrimaryFinishHandlers", [commitparam], undefined, handlers);
      if (handlers.recordExists())
        this.handlerlist.push({ vm, handlers });
      else
        handlers[Symbol.dispose]();
    }
  }

  async invoke(stage: "onCommit" | "onRollback") {
    for (const handler of this.handlerlist) {
      if (handler.vm.__isShutdown()) {
        /* This may happen if the lifecycles of VMs aren't managed properly. This is because we simply invoke __CallCommitHandlers on
           all VMs known to the context as its pretty fast and this absolves us of having to coordinate stashed works and commit handlers
           between HSVM and TS. We should normally get away with this as loadlib VMs last as long as the codecontext and thus live longer than
           database transactions */
        throw new Error(`VM associated with finish handler is already shutdown`);
      }
      await handler.vm.loadlib("wh::internal/transbase.whlib").__CallCommitHandlers(handler.handlers, stage);
    }
  }

  [Symbol.dispose]() {
    for (const handler of this.handlerlist)
      handler.handlers[Symbol.dispose]();
    this.handlerlist = [];
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
  private async prepareFinish(commit: boolean): Promise<HandlerList> {
    if (commit)
      await Promise.all(Array.from(this.finishhandlers.values()).map(h => h.onBeforeCommit?.()));

    /* Note that we don't need to store JS finishhandlers, as JS stores this per work. For HS this is 'global' (primary transaction object) state which
       is why we need to copy the HS commithandler state at commit time (as commithandlers may start new work) */
    const handlerlist = new HandlerList();
    await handlerlist.setup(commit);
    return handlerlist;
  }

  private async invokeFinishHandlers(handlers: HandlerList, stage: "onCommit" | "onRollback") {
    //invoke all finishedhandlers in 'parallel' and wait for them to finish
    await Promise.all(Array.from(this.finishhandlers.values()).map(h => h[stage]?.()));
    //serialize HSVM handlers, we don't expect them to deal with overlapping calls
    await handlers.invoke(stage);
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

  async uploadBlob(data: WebHareBlob | ReadableStream<Uint8Array>): Promise<WebHareBlob> {
    if (!this.open)
      throw new Error(`Work is already closed`);
    if (!this.conn.pgclient)
      throw new Error(`Connection was already closed`);
    if (debugFlags["db-readonly"])
      throw new DBReadonlyError();

    const lock = this.conn.reftracker.getLock("query lock: UPLOADBLOB");
    try {
      return await uploadBlobToConnection(this.conn.pgclient, data);
    } finally {
      lock.release();
    }
  }

  async commit() {
    if (!this.open)
      throw new Error(`Work is already closed`);
    if (!this.conn.pgclient)
      throw new Error(`Connection was already closed`);
    if (debugFlags["db-readonly"])
      throw new DBReadonlyError();

    let handlers;

    //FIXME support readonly mode (if it stays?). HareScript solved it at this level, but perhaps we can move the problem to PG or the user we connect with ?
    try {
      handlers = await this.prepareFinish(true);
    } catch (e) {
      try {
        await this.rollback();
      } catch (ignore) {
        //TODO a rollback finish handler might throw but we can't deal with that. Ignore that for now
      }
      throw e;
    }

    this.open = false;
    const lock = this.conn.reftracker.getLock("query lock: COMMIT");
    try {
      const commitresult = await this.conn.pgclient.query("COMMIT");
      if (commitresult.command !== "COMMIT")
        throw new Error(`Commit failed (usually due to earlier errors on this transaction)`);

      this.commituniqueevents.forEach(event => broadcast(event));
      this.commitdataevents.forEach(event => broadcast(event.name, event.data));
      await this.invokeFinishHandlers(handlers, "onCommit");
    } finally {
      //TODO if (pre)commit fails we should
      lock.release();
      this.__releaseMutexes();
      this.conn.openwork = undefined;
    }
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
    if (!this.conn.pgclient)
      throw new Error(`Connection was already closed`);

    this.open = false;
    using handlers = await this.prepareFinish(false);
    const lock = this.conn.reftracker.getLock("query lock: ROLLBACK");
    try {
      await sql`ROLLBACK`.execute(this.conn._db);
      await this.invokeFinishHandlers(handlers, "onRollback");
    } finally {
      lock.release();
      this.__releaseMutexes();
      this.conn.openwork = undefined;
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

/* Every WHDBConnection uses one pgclient, and runs all the queries over that transaction, so
   no pooling is used within one connection.
*/

/** The WHDBConnectionImpl implements the kysely PostgresPool and PostgresPoolClient interfaces,
    so we can take over connection handling. pg-pool has a timeout of a few seconds when the
    script ends, don't want that.
    @typeParam T - Kysely database definition interface
*/
export class WHDBConnectionImpl extends WHDBPgClient implements WHDBConnection, PostgresPool, PostgresPoolClient {
  _db;
  reftracker;
  openwork?: Work;
  lastopen?: Error;

  constructor() {
    super();
    this._db = this.buildKyselyClient();

    type ExposeSocket = {
      _intlCon: { socket: { _socket: { ref(): void; unref(): void } } };
    };

    this.reftracker = new RefTracker(checkIsRefCounted((this.pgclient! as unknown as ExposeSocket)._intlCon.socket._socket), { initialref: true });
    this.reftracker.dropInitialReference();
  }

  buildKyselyClient() {
    return new Kysely<unknown>({
      // PostgresDialect requires the Cursor dependency
      dialect: new PostgresDialect({
        pool: this
      }),
      plugins: [new KyselyInToAnyPlugin],
    });
  }

  /// Allocates a PostgresPoolClient
  async connect(): Promise<WHDBConnectionImpl> {
    if (this.connected)
      return this;

    const lock = this.reftracker.getLock("connect lock");
    try {
      await super.connect();
    } finally {
      lock.release();
    }
    return this;
  }

  async end() {
    // is needed for PostgresPool implementation
  }

  async execute(command: string) {
    using lock = this.reftracker.getLock("query lock");
    void (lock);
    return await this.pgclient!.execute(command);
  }

  query<R extends object>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R extends object>(sqlquery: string, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>>;

  query<R extends object>(sqlquery: string | PostgresCursor<R>, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (typeof sqlquery !== "string")
      return super.query(sqlquery);

    return (async () => { //lock until the query starts returning or we may just abort the nodejs main loop.
      using lock = this.reftracker.getLock("query lock");
      void (lock);

      await this.connectpromise;
      return await super.query<R>(sqlquery, parameters);
    })();
  }

  /// Releases the PostgresPoolClient
  release() {
    //
  }

  /** kysely query builder */
  db<T>(): Kysely<T> {
    /* Convert the type, the types don't influence the underlying implementation anyway */
    return this._db as Kysely<T>;
  }

  isWorkOpen() {
    return this.openwork?.open || false;
  }

  private checkState(expectwork: true): Work; //guaranteed to return a work object or throw
  private checkState(expectwork: false): null; //guaranteed to return null or throw
  private checkState(expectwork: undefined): Work | null;

  private checkState(expectwork: boolean | undefined): Work | null {
    if (!this.pgclient)
      throw new Error(`Connection was already closed`);
    if (expectwork !== undefined && this.isWorkOpen() !== expectwork) {
      throw new Error(`Work has already been ${expectwork ? 'closed' : 'opened'}${debugFlags.async ? "" : " - WEBHARE_DEBUG=async may help locating this"}`, { cause: this.lastopen });
    }
    return this.openwork || null;
  }

  async beginWork(options?: WorkOptions): Promise<WorkObject> {
    if (options?.isolationLevel && !PGIsolationLevels.includes(options.isolationLevel))
      throw new Error(`Invalid isolation level ${options.isolationLevel}`);

    let lock;
    let mutexes: Mutex[] | undefined = [];
    let newwork;
    let lastopen: Error | undefined;

    if (debugFlags.async)
      lastopen = new Error(`Work was last opened here`); //We must grab the stack before the first await

    try {
      if (options?.mutex)
        for (const name of Array.isArray(options.mutex) ? options.mutex : [options.mutex])
          mutexes.push(await lockMutex(name));
      if (debugFlags["db-readonly"])
        throw new DBReadonlyError();

      this.checkState(false); //we must have the mutexes before checking work state otherwise code can't protect itself using the lock

      lock = this.reftracker.getLock("work lock");
      newwork = new Work(this);
      for (const mutex of mutexes)
        newwork.addMutex(mutex);
      mutexes = undefined;

      if (debugFlags.async)
        this.lastopen = lastopen;

      const isolationLevel = options?.isolationLevel ?? "read committed";
      await this.connectpromise;
      await this.execute(`START TRANSACTION ISOLATION LEVEL ${isolationLevel} READ WRITE`);
    } catch (e) {
      newwork?.__releaseMutexes();
      if (mutexes)
        mutexes.forEach(m => m.release());
      throw e;
    } finally {
      lock?.release();
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
}

/** A database connection
    @typeParam T - Kysely database definition interface
*/

type WHDBConnection = Pick<WHDBConnectionImpl, "db" | "beginWork" | "commitWork" | "rollbackWork" | "isWorkOpen" | "onFinishWork" | "broadcastOnCommit" | "uploadBlob" | "nextVal" | "nextVals">;

const connsymbol = Symbol("WHDBConnection");
const workqueuesymbol = Symbol("WorkQueueSymbol");

export function getConnection(): WHDBConnection {
  return ensureScopedResource(connsymbol, () => new WHDBConnectionImpl, async (conn) => {
    if (isWorkOpen())
      await rollbackWork();

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

/** Get the next primary key value for a specific table
*/
export function nextVal(table: string) {
  return getConnection().nextVal(table);
}

/** Get multiple primary key values for a specific table
*/
export function nextVals(table: string, howMany: number) {
  return getConnection().nextVals(table, howMany);
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

export function isDatabaseError(e: unknown): e is DatabaseError {
  return isError(e) && e instanceof DatabaseError;
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
