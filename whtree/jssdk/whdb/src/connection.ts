/* This module is directly used by `wh update-generated-files`
   to bootstrap the WebHare configuration without relying on services' backendConfig. When
   adding imports, make sure this separate invocation still works
*/
import {
  PostgresCursor,
  PostgresQueryResult,
} from 'kysely';

import { Connection, GlobalTypeMap, QueryOptions, BindParam, DataTypeOIDs, QueryResult, FieldInfo } from './../vendor/postgresql-client/src/index';
import { debugFlags } from '@webhare/env/src/envbackend';
import { BlobType } from "./blobs";
import { ArrayFloat8Type, ArrayMoneyType, ArrayTidType, Float8Type, MoneyType, TidType } from "./types";
import { getIntlConnection } from '../vendor/postgresql-client/src/connection/intl-connection';

let configuration: { bloboid: number } | null = null;

interface PGConnectionDebugEvent {
  location: string;
  connection: Connection;
  message: string;
  sql?: string;
  args?: unknown[];
}

//Read database connection settings and configure our PG driver. We attempt this at the start of every connection (bootstrap might need to reinvoke us?)
async function configureWHDBClient(pg: Connection) {
  //TODO barrier against multiple parallel configureWHDBClient invocations
  const bloboidquery = await pg.query(
    `SELECT t.oid, t.typname
      FROM pg_catalog.pg_type t
          JOIN pg_catalog.pg_namespace n ON t.typnamespace = n.oid
          JOIN pg_catalog.pg_proc p ON t.typinput = p.oid
    WHERE nspname = 'webhare_internal' AND t.typname = 'webhare_blob' AND proname = 'record_in'`);

  //For the WHDB a NUMERIC is always a Number. this might not be that future proof..
  GlobalTypeMap.register([MoneyType, ArrayMoneyType]);
  GlobalTypeMap.register([Float8Type, ArrayFloat8Type]);
  GlobalTypeMap.register([TidType, ArrayTidType]);

  if (bloboidquery.rows) {
    configuration = { bloboid: bloboidquery.rows[0][0] };
    BlobType.oid = configuration.bloboid;
    GlobalTypeMap.register(BlobType);
  }
}

//the *actual* returnvalue from `query`
export interface FullPostgresQueryResult<R> extends PostgresQueryResult<R> {
  fields?: FieldInfo[];
}

export class WHDBPgClient {
  pgclient?;
  connected = false;
  connectpromise: Promise<void>;

  constructor() {
    this.pgclient = new Connection({
      host: process.env.PGHOST + "/.s.PGSQL.5432", //apparently it needs to be spelled out..
      database: process.env.WEBHARE_DBASENAME,
      rollbackOnError: false
    });
    if (debugFlags["pg-logcommands"])
      this.pgclient.on("debug", (evt) => this.onDebug(evt));
    if (debugFlags["pg-logsocket"])
      getIntlConnection(this.pgclient).socket.on("debug", (evt) => this.onDebug(evt));

    this.connectpromise = this.pgclient.connect();
  }

  private onDebug(evt: PGConnectionDebugEvent) {
    console.log(evt.location, evt.sql ?? evt.args);
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
      if (!configuration)
        await configureWHDBClient(this.pgclient);
      this.connected = true;
    }
    return this;
  }

  close() {
    this.pgclient?.close();
    this.pgclient = undefined;
  }
}
