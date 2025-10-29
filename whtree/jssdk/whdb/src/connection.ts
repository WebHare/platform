/* This module is directly used by `wh apply --offline --nodb config.base`
   to bootstrap the WebHare configuration without relying on services' backendConfig. When
   adding imports, make sure this separate invocation still works
*/
import type {
  PostgresCursor,
  PostgresQueryResult,
} from 'kysely';

import { Connection, type QueryOptions, BindParam, DataTypeOIDs, type QueryResult, type FieldInfo, DataTypeMap } from './../vendor/postgrejs/src/index';
import { debugFlags } from '@webhare/env/src/envbackend';
import { BlobType } from "./blobs";
import { ArrayFloat8Type, ArrayMoneyType, ArrayTidType, ArrayWHTimestampType, ArrayWHTimestampTzType, Float8Type, MoneyType, TidType, WHTimestampType, WHTimestampTzType } from "./types";
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
import { getPGType } from './metadata';
import bridge from '@mod-system/js/internal/whmanager/bridge';
import { ArrayUuidType, UuidType } from '../vendor/postgrejs/src/data-types/uuid-type';

let configurationPromise: Promise<void> | undefined;
let configuration: { bloboid: number } | null = null;

interface PGConnectionDebugEvent {
  location: string;
  connection: Connection;
  message: string;
  sql?: string;
  args?: unknown[];
}

export const whdbTypeMap = new DataTypeMap();

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

    whdbTypeMap.register([OidType, VectorOidType, ArrayOidType]);
    whdbTypeMap.register([BoolType, ArrayBoolType]);
    whdbTypeMap.register([Float8Type, ArrayFloat8Type]);
    whdbTypeMap.register([MoneyType, ArrayMoneyType]);
    whdbTypeMap.register([Int2Type, ArrayInt2Type]); //we don't use this type ourselves, but looks like the WHDB layer may pick it when sending id IN ... ?
    whdbTypeMap.register([Int4Type, ArrayInt4Type]);
    whdbTypeMap.register([Int8Type, ArrayInt8Type]);

    whdbTypeMap.register([UuidType, ArrayUuidType]);
    whdbTypeMap.register([ByteaType, ArrayByteaType]);
    whdbTypeMap.register([Int2VectorType, ArrayInt2VectorType]);//needed to read PG catalogs
    whdbTypeMap.register({ ...VarcharType, name: "name", oid: DataTypeOIDs.name }); //needed to read PG catalogs
    whdbTypeMap.register({ ...VarcharType, name: "text", oid: DataTypeOIDs.text }); //I don't think we use 'text' columns in a WebHare DB, but we *do* cast to ::text on occassion
    whdbTypeMap.register([CharType, ArrayCharType]); //needed to read PG catalogs
    whdbTypeMap.register([VarcharType, ArrayVarcharType]);

    whdbTypeMap.register([TidType, ArrayTidType]); //Postgres TID (Tuple IDentifier)
    whdbTypeMap.register([WHTimestampType, ArrayWHTimestampType]);
    whdbTypeMap.register([WHTimestampTzType, ArrayWHTimestampTzType]);

    const bloboidquery = await getPGType(pg, "webhare_internal", "webhare_blob");
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

export class WHDBPgClient {
  pgclient?;
  connected = false;
  connectpromise: Promise<void>;

  constructor() {
    this.pgclient = getPGConnection();

    const client = this.pgclient;
    this.connectpromise = client.connect().then(() => configureWHDBClient(client));

    // Make sure that failed connections do not result in uncaught rejections when nobody calls connect()
    this.connectpromise.catch(() => { });
  }

  query<R>(cursor: PostgresCursor<R>): PostgresCursor<R>;
  query<R>(sqlquery: string, parameters?: readonly unknown[]): Promise<PostgresQueryResult<R>>;

  query<R>(sqlquery: string | PostgresCursor<R>, parameters?: unknown[]): Promise<PostgresQueryResult<R>> | PostgresCursor<R> {
    if (!this.pgclient)
      throw new Error(`Connection was already closed`);

    if (typeof sqlquery === "string") {
      const queryoptions: QueryOptions = {
        params: [],
        utcDates: true,
        typeMap: whdbTypeMap,
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

      return this.pgclient!.query(sqlquery, queryoptions).then((result: QueryResult): FullPostgresQueryResult<R> => {
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
      });
    }
    return sqlquery;
  }


  /// Allocates a PostgresPoolClient
  async connect(): Promise<WHDBPgClient> {
    if (!this.connected) {
      if (!this.pgclient)
        throw new Error(`Connection was already closed`);

      await this.connectpromise;
      this.connected = true;
    }
    return this;
  }

  async close() {
    await this.pgclient?.close();
    this.pgclient = undefined;
  }
}

const bindables = {
  uuid: DataTypeOIDs.uuid,
  timestamptz: DataTypeOIDs.timestamptz,
} as const;

export function pgBindParam(value: unknown, type: keyof typeof bindables): BindParam {
  return new BindParam(bindables[type], value);
}
