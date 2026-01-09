// metadata.ts is low level metadata management, we wrap it in nicer calls

import { getConnection, type WHDBConnectionImpl } from "./impl";
import * as metadata from "./metadata";

export async function schemaExists(schema: string) {
  const conn = getConnection() as WHDBConnectionImpl;
  const client = await conn.pool.connect();
  try {
    return await metadata.schemaExists(client, schema);
  } finally {
    client.release();
  }
}

export async function tableExists(schema: string, table: string) {
  const conn = getConnection() as WHDBConnectionImpl;
  const client = await conn.pool.connect();
  try {
    return await metadata.tableExists(client, schema, table);
  } finally {
    client.release();
  }
}

export async function columnExists(schema: string, table: string, column: string) {
  const conn = getConnection() as WHDBConnectionImpl;
  const client = await conn.pool.connect();
  try {
    return await metadata.columnExists(client, schema, table, column);
  } finally {
    client.release();
  }
}
