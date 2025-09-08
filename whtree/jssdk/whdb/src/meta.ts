// metadata.ts is low level metadata management, we wrap it in nicer calls

import { getConnection, type WHDBConnectionImpl } from "./impl";
import * as metadata from "./metadata";

export async function schemaExists(schema: string) {
  const conn = getConnection() as WHDBConnectionImpl;
  using lock = conn.reftracker.getLock("query lock: metadata query");
  void (lock);
  return await metadata.schemaExists((await conn.connect()).pgclient!, schema);
}

export async function tableExists(schema: string, table: string) {
  const conn = getConnection() as WHDBConnectionImpl;
  using lock = conn.reftracker.getLock("query lock: metadata query");
  void (lock);
  return await metadata.tableExists((await conn.connect()).pgclient!, schema, table);
}

export async function columnExists(schema: string, table: string, column: string) {
  const conn = getConnection() as WHDBConnectionImpl;
  const pg = (await conn.connect()).pgclient!;
  using lock = conn.reftracker.getLock("query lock: metadata query"); //TODO Get rid of these locks but we need to columnExists & co to invoke the WHDB Connection and not the lowlevel PG connection then?
  void (lock);
  return await metadata.columnExists(pg, schema, table, column);
}
