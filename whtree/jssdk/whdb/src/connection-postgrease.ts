/* This module is directly used by `wh apply --offline --nodb config.base`
   to bootstrap the WebHare configuration without relying on services' backendConfig. When
   adding imports, make sure this separate invocation still works
*/
import { bindParam, nonDateCodecs, CodecRegistry, DataTypeOids, type PGBoundParam, connect, type PGConnection, type PGQueryOptions, type PGQueryResult, DataTypeTimeStampTzTemporal, DataTypeTimeStampTzTemporalArray } from '@webhare/postgrease';
import type {
  PostgresCursor,
  PostgresPoolClient,
  PostgresQueryResult,
} from 'kysely';

import bridge from '@mod-system/js/internal/whmanager/bridge';
import type { WHDBClientInterface, WHDBPgClientOptions } from './connectionbase';
import { BlobType, DataTypeWHTimeStamp, DataTypeWHTimeStampArray, MoneyType, MoneyTypeArray } from './types-postgrease';
import { debugFlags } from '@webhare/env/src/envbackend';
import { RefTracker } from '@mod-system/js/internal/whmanager/refs';
export { DatabaseError } from "@webhare/postgrease";

let configurationPromise: Promise<void> | undefined;
let configuration: { bloboid: number } | null = null;

/*
interface PGConnectionDebugEvent {
  location: string;
  connection: Connection;
  message: string;
  sql?: string;
  args?: unknown[];
}
*/

export const codecRegistry = new CodecRegistry([
  ...nonDateCodecs,
  DataTypeWHTimeStamp,
  DataTypeWHTimeStampArray,
  DataTypeTimeStampTzTemporal,
  DataTypeTimeStampTzTemporalArray,
  MoneyType,
  MoneyTypeArray,
]);

// Don't have a WHDBPgClient object when calling this function, so use this version instad of the meta.ts one
async function getPGTypeRaw(pg: PGConnection, schema: string, type: string): Promise<{ oid: number; typname: string } | null> {
  const result = await pg.query(`
    SELECT t.oid, t.typname
      FROM pg_catalog.pg_type t
           JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
           JOIN pg_catalog.pg_proc p ON t.typinput = p.oid
     WHERE nspname = $1 AND t.typname = $2 AND proname = 'record_in'`, [schema, type]);

  return result.rows?.length ? result.rows[0] : null;
}

//Read database connection settings and configure our PG driver. We attempt this at the start of every connection (bootstrap might need to reinvoke us?)
async function configureWHDBClient(pg: PGConnection): Promise<void> {
  //manually setting as workaround for https://github.com/panates/postgrejs/issues/51. but once we start pooling and reuse connections we'll need to do this too
  await pg.query(`SET application_name = '${process.pid}:${bridge.getGroupId()}'`);

  // when another connection is already configuring, wait for it
  // eslint-disable-next-line no-unmodified-loop-condition -- the other connection will modify `configuration`
  while (!configuration && configurationPromise) {
    const curPromise = configurationPromise;
    try {
      return await curPromise;
    } catch (e) {
      // The other connection failed to configure. Retry wait if another connection has already taken over configuring
      if (curPromise !== configurationPromise)
        continue;
      // No other connection has taken over yet, retry ourselves
      configurationPromise = undefined;
      break;
    }
  }
  if (configuration)
    return;

  // Run the typemap registration and blob oid lookup only once
  // INV: configurationPromise === undefined
  configurationPromise = (async () => {
    /* Be sure to run wh.database.wasm.primitivevalues when modifying this table. Order matters when we send types, autodetect will prefer the last-registered types
       Prefer the order in data-type-map.ts. Use wh psql and \d to figure out types on an existing table

       For the WHDB a NUMERIC is always a Number. this might not be that future proof..

       FOOTGUN: for arrays, the driver only tests the first array item, and checks this registrations in reverse order.
       So, make sure that the most generic type is registered last!!!
    */

    const bloboidquery = await getPGTypeRaw(pg, "webhare_internal", "webhare_blob");
    if (bloboidquery) {
      configuration = { bloboid: bloboidquery.oid };
      BlobType.oid = configuration.bloboid;
      configurationPromise = undefined;
    } else
      throw new Error(`Could not find webhare_blob type`);

    codecRegistry.register(BlobType);
  })();

  // Await the result of configuration. If it fails, this connection isn't usable anyway, so we can leak the error
  await configurationPromise;
}

//the *actual* returnvalue from `query`
export interface FullPostgresQueryResult<R> extends PostgresQueryResult<R> {
  fields?: PGQueryResult["fields"];
}

//function onDebug(evt: PGConnectionDebugEvent) {
//  console.log(`[${performance.now().toFixed(3).padStart(10)}] ${evt.location}: ${evt.message}`);
//}

export async function getPGConnection() {
  const pgclient = await connect({
    port: parseInt(process.env.PGPORT!) || 5432,
    host: (process.env.WEBHARE_PGHOST ?? process.env.PGHOST ?? ""),
    database: process.env.WEBHARE_DBASENAME ?? "",
    user: "postgres",
    //applicationName: process.pid + ':' + bridge.getGroupId() //FIXME https://github.com/panates/postgrejs/issues/51
  });

  //if (debugFlags["pg-logcommands"])
  //  pgclient.on("debug", onDebug);
  //if (debugFlags["pg-logsocket"])
  //  getIntlConnection(pgclient).socket.on("debug", onDebug);

  return pgclient;
}

export class WHDBPgClient implements WHDBClientInterface, PostgresPoolClient {
  pgclient: PGConnection;
  options?: WHDBPgClientOptions;
  reftracker: RefTracker;

  constructor(client: PGConnection, options?: WHDBPgClientOptions) {
    this.pgclient = client;
    this.options = options;
    this.reftracker = new RefTracker(client.getRefObject(), { initialref: true });
    this.reftracker.dropInitialReference();
  }

  private async executeSqlQuery<R>(sqlquery: string, parameters?: readonly unknown[]): Promise<FullPostgresQueryResult<R>> {
    using lock = this.reftracker.getLock("postgresql query");
    void lock;

    const params = [];
    const queryoptions: PGQueryOptions = {
      codecRegistry: this.options?.raw ? undefined : codecRegistry,
      //fetchCount: 4294967295 //TODO we should probably go for cursors instead
    };

    if (parameters)
      for (const param of parameters) {
        if (Array.isArray(param) && param.length === 0)
          params.push(bindParam([], DataTypeOids._int2)); //workaround for postgresql-client not detecting a type for this.
        else if (typeof param === "string")
          params.push(bindParam(param, DataTypeOids.text));
        else
          params.push(param);
      }

    if (debugFlags["postgresql:logquery"])
      console.log({ sqlquery, ...queryoptions });

    const result = await this.pgclient!.query(sqlquery, params, queryoptions);
    if (debugFlags["postgresql:logquery"])
      console.log("result", result);

    return {
      rows: result.rows,
      rowCount: result.rows.length,
      command: result.command! as "UPDATE" | "DELETE" | "SELECT" | "INSERT", //apparently kysely assumes only these can appear in queries
      fields: result.fields
    };
  }

  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(sqlquery: string, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>>;

  query<R>(sqlquery: string | PostgresCursor<R>, parameters?: unknown[]): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (!this.pgclient)
      throw new Error(`Connection was already closed`);

    if (typeof sqlquery === "string")
      return this.executeSqlQuery<R>(sqlquery, parameters);

    return sqlquery;
  }

  release() {
    this.options?.onRelease?.(this);
  }

  async close() {
    using lock = this.reftracker.getLock("postgresql close connection");
    void lock;

    await this.pgclient?.close();
  }

  getRefObject() {
    return this.pgclient.getRefObject();
  }

  getBackendProcessId(): number | undefined {
    return this.pgclient.getBackendProcessId();
  }
}

export async function createConnection(options?: WHDBPgClientOptions): Promise<WHDBPgClient> {
  const client = await getPGConnection();
  if (!options?.raw)
    await configureWHDBClient(client);
  return new WHDBPgClient(client, options);
}

export function pgBindParam(value: unknown, type: "uuid" | "timestamptz" | "float8"): PGBoundParam {
  return bindParam(value, type);
}
