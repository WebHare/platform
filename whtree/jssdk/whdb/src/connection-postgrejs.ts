/* This module is directly used by `wh apply --offline --nodb config.base`
   to bootstrap the WebHare configuration without relying on services' backendConfig. When
   adding imports, make sure this separate invocation still works
*/
import type {
  PostgresCursor,
  PostgresPoolClient,
  PostgresQueryResult,
} from 'kysely';

import { Connection, type QueryOptions, BindParam, DataTypeOIDs, type FieldInfo, DataTypeMap } from '../vendor/postgrejs/src/index';
import { debugFlags } from '@webhare/env/src/envbackend';
import { ArrayFloat8Type, ArrayMoneyType, ArrayTidType, ArrayWHTimestampType, ArrayWHTimestampTzType, Float8Type, MoneyType, TidType, WHTimestampType, WHTimestampTzType, BlobType } from "./types-postgrejs";
import { getIntlConnection } from '../vendor/postgrejs/src/connection/intl-connection';
import { ArrayVarcharType, VarcharType } from '../vendor/postgrejs/src/data-types/varchar-type';
import { ArrayBoolType, BoolType } from '../vendor/postgrejs/src/data-types/bool-type';
import { ArrayByteaType, ByteaType } from '../vendor/postgrejs/src/data-types/bytea-type';
import { ArrayInt4Type, Int4Type } from '../vendor/postgrejs/src/data-types/int4-type';
import { ArrayInt8Type, Int8Type } from '../vendor/postgrejs/src/data-types/int8-type';
import { ArrayInt2Type, Int2Type } from '../vendor/postgrejs/src/data-types/int2-type';
import { ArrayOidType, OidType, VectorOidType } from '../vendor/postgrejs/src/data-types/oid-type';
import { ArrayInt2VectorType, Int2VectorType } from '../vendor/postgrejs/src/data-types/int2-vector-type';
import { ArrayCharType, CharType } from '../vendor/postgrejs/src/data-types/char-type';
import bridge from '@mod-system/js/internal/whmanager/bridge';
import { ArrayUuidType, UuidType } from '../vendor/postgrejs/src/data-types/uuid-type';
import type { WHDBClientInterface, WHDBPgClientOptions } from './connectionbase';
import { RefTracker } from '@mod-system/js/internal/whmanager/refs';

export { DatabaseError, type Connection } from "../vendor/postgrejs/src";

let configurationPromise: Promise<void> | undefined;
let configuration: { bloboid: number } | null = null;

interface PGConnectionDebugEvent {
  location: string;
  connection: Connection;
  message: string;
  sql?: string;
  args?: unknown[];
}

/// Type map without dynamic types (for bootstrap)
let rawTypeMap: DataTypeMap | undefined;

export const whdbTypeMap = new DataTypeMap();

function baseInitTypeMap(typeMap: DataTypeMap): DataTypeMap {
  typeMap.register([OidType, VectorOidType, ArrayOidType]);
  typeMap.register([BoolType, ArrayBoolType]);
  typeMap.register([Float8Type, ArrayFloat8Type]);
  typeMap.register([MoneyType, ArrayMoneyType]);
  typeMap.register([Int2Type, ArrayInt2Type]); //we don't use this type ourselves, but looks like the WHDB layer may pick it when sending id IN ... ?
  typeMap.register([Int4Type, ArrayInt4Type]);
  typeMap.register([Int8Type, ArrayInt8Type]);

  typeMap.register([UuidType, ArrayUuidType]);
  typeMap.register([ByteaType, ArrayByteaType]);
  typeMap.register([Int2VectorType, ArrayInt2VectorType]);//needed to read PG catalogs
  typeMap.register({ ...VarcharType, name: "name", oid: DataTypeOIDs.name }); //needed to read PG catalogs
  typeMap.register({ ...VarcharType, name: "text", oid: DataTypeOIDs.text }); //I don't think we use 'text' columns in a WebHare DB, but we *do* cast to ::text on occassion
  typeMap.register([CharType, ArrayCharType]); //needed to read PG catalogs
  typeMap.register([VarcharType, ArrayVarcharType]);

  typeMap.register([TidType, ArrayTidType]); //Postgres TID (Tuple IDentifier)
  typeMap.register([WHTimestampType, ArrayWHTimestampType]);
  typeMap.register([WHTimestampTzType, ArrayWHTimestampTzType]);
  return typeMap;
}

// Get the oid and typename of a type. Can't use meta.ts version because the calling conventions are different
async function getPGTypeRaw(pg: Connection, schema: string, type: string): Promise<{ oid: number; typname: string } | null> {
  const result = await pg.query(`
    SELECT t.oid, t.typname
      FROM pg_catalog.pg_type t
           JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
           JOIN pg_catalog.pg_proc p ON t.typinput = p.oid
     WHERE nspname = $1 AND t.typname = $2 AND proname = 'record_in'`, { params: [schema, type], objectRows: true });

  return result.rows?.length ? result.rows[0] : null;
}

//Read database connection settings and configure our PG driver. We attempt this at the start of every connection (bootstrap might need to reinvoke us?)
async function configureWHDBClient(pg: Connection): Promise<void> {
  //manually setting as workaround for https://github.com/panates/postgrejs/issues/51. but once we start pooling and reuse connections we'll need to do this too
  await pg.execute(`SET application_name = '${process.pid}:${bridge.getGroupId()}'`);

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

    baseInitTypeMap(whdbTypeMap);

    const bloboidquery = await getPGTypeRaw(pg, "webhare_internal", "webhare_blob");
    if (bloboidquery) {
      configuration = { bloboid: bloboidquery.oid };
      BlobType.oid = configuration.bloboid;
      whdbTypeMap.register(BlobType);
      configurationPromise = undefined;
    } else
      throw new Error(`Could not find webhare_blob type`);
  })();

  // Await the result of configuration. If it fails, this connection isn't usable anyway, so we can leak the error
  await configurationPromise;
}

//the *actual* returnvalue from `query`
export interface FullPostgresQueryResult<R> extends PostgresQueryResult<R> {
  fields?: FieldInfo[];
}

function onDebug(evt: PGConnectionDebugEvent) {
  console.log(`[${performance.now().toFixed(3).padStart(10)}] ${evt.location}: ${evt.message}`);
}

export function getPGConnection() {
  const pgclient = new Connection({
    port: parseInt(process.env.PGPORT!) || 5432,
    host: (process.env.WEBHARE_PGHOST ?? process.env.PGHOST),
    database: process.env.WEBHARE_DBASENAME,
    rollbackOnError: false,
    applicationName: process.pid + ':' + bridge.getGroupId() //FIXME https://github.com/panates/postgrejs/issues/51
  });

  if (debugFlags["pg-logcommands"])
    pgclient.on("debug", onDebug);
  if (debugFlags["pg-logsocket"])
    getIntlConnection(pgclient).socket.on("debug", onDebug);

  return pgclient;
}

class WHDBPgClient implements WHDBClientInterface, PostgresPoolClient {
  options;
  pgclient?;
  reftracker: RefTracker;
  dataTypeMap: DataTypeMap;

  constructor(pgclient: Connection, options?: WHDBPgClientOptions) {
    this.options = options;
    this.dataTypeMap = options?.raw ? (rawTypeMap ??= baseInitTypeMap(new DataTypeMap())) : whdbTypeMap;
    this.pgclient = pgclient;
    this.reftracker = new RefTracker(this.getRefObject(), { initialref: true });
    this.reftracker.dropInitialReference();
  }

  private async executeSqlQuery<R>(sqlquery: string, parameters?: readonly unknown[]): Promise<FullPostgresQueryResult<R>> {
    using lock = this.reftracker.getLock("postgresql query");
    void lock;

    const queryoptions: QueryOptions = {
      params: [],
      utcDates: true,
      typeMap: this.dataTypeMap,
      fetchCount: 4294967295 //TODO we should probably go for cursors instead
    };

    if (parameters)
      for (const param of parameters) {
        if (Array.isArray(param) && param.length === 0)
          queryoptions.params!.push(new BindParam(DataTypeOIDs._int2, [])); //workaround for postgresql-client not detecting a type for this.
        else if (typeof param === "string")
          queryoptions.params!.push(new BindParam(DataTypeOIDs.text, param));
        else
          queryoptions.params!.push(param);
      }

    if (debugFlags["postgresql:logquery"])
      console.log({ sqlquery, ...queryoptions });

    const result = await this.pgclient!.query(sqlquery, queryoptions);
    const rows = [];
    if (result.rows && result.fields)
      for (const row of result.rows) {
        const newrow: R = {} as R;
        for (let i = 0; i < result.fields.length; ++i) {
          newrow[result.fields![i].fieldName as keyof R] = row[i];
        }
        rows.push(newrow);
      }

    if (debugFlags["postgresql:logquery"])
      console.log("result", result);

    return {
      rows,
      rowCount: rows.length || result.rowsAffected || 0,
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
    using lock = this.reftracker.getLock("postgresql query");
    void lock;

    await this.pgclient?.close();
    this.pgclient = undefined;
  }

  getRefObject(): { ref(): void; unref(): void } {
    const socket = getIntlConnection(this.pgclient!).socket["_socket"];
    if (!socket)
      throw new Error(`getPGConnection: could not get underlying socket`);
    return socket;
  }

  getBackendProcessId(): number | undefined {
    return this.pgclient?.processID;
  }
}

export async function createConnection(options?: WHDBPgClientOptions): Promise<WHDBPgClient> {
  const pgclient = getPGConnection();
  await pgclient.connect();
  if (!options?.raw)
    await configureWHDBClient(pgclient);
  return new WHDBPgClient(pgclient, options);
}

const bindables = {
  uuid: DataTypeOIDs.uuid,
  timestamptz: DataTypeOIDs.timestamptz,
  float8: DataTypeOIDs.float8,
} as const;

export function pgBindParam(value: unknown, type: keyof typeof bindables): BindParam {
  return new BindParam(bindables[type], value);
}
