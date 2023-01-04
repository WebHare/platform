/* WebHare database SQL driver
   Uses https://github.com/felixfbecker/node-sql-template-strings as inspiration
*/

import { Client, Connection, QueryConfig } from 'pg';

let pgclient: WHDBClient | null = null;
let pgclientpromise: Promise<WHDBClient> | null = null;

interface ClientWithConnection extends Client {
  connection: Connection;
}

class WHDBClient {
  client: ClientWithConnection;
  refcount = 0;

  constructor() {
    //FIXME coordinate reading settings with env or env/backend
    //We should have named the folder 'postgres' instead of postgresql, but leave that for a potential future update
    this.client = new Client({ host: process.env.WEBHARE_DATAROOT + "/postgresql", database: process.env.WEBHARE_DBASENAME }) as ClientWithConnection;
  }

  async connect() {
    this.client.connect();
    //@ts-ignore unref really exists!
    this.client.connection.stream.unref();
  }

  updateRefcount(direction: 1 | -1) {
    if (direction == 1) {
      if (++this.refcount == 1) //first ref
        //@ts-ignore ref and unref really exist!
        this.client.connection.stream.ref();
    } else {
      if (--this.refcount == 0) //last ref
        //@ts-ignore ref and unref really exist!
        this.client.connection.stream.unref();
    }
  }

  async query(queryTextOrConfig: string | QueryConfig, values?: unknown[]) {

    this.updateRefcount(+1);
    try {
      return await this.client.query(queryTextOrConfig, values);
    } finally {
      this.updateRefcount(-1);
    }
  }
}

async function ensureConnection(): Promise<WHDBClient> {
  if (pgclient)
    return pgclient;

  if (!pgclientpromise) {
    pgclientpromise = (async () => {
      //FIXME coordinate with env or env/backend
      const client = new WHDBClient;
      await client.connect();

      pgclient = client;
      return client;
    })();
  }

  return pgclientpromise;
}

class Work {
  private open = false;
  client: WHDBClient;

  constructor(client: WHDBClient) {
    this.client = client;
  }

  async _beginTransaction() {
    //NOTE: we're not exporting Work so we should be able to assume that any open Work immediately invokes _beginTransaction
    if (this.open)
      throw new Error(`Work objects are not reusable`);

    this.client.updateRefcount(+1);
    this.open = true;
    await this.client.query("START TRANSACTION ISOLATION LEVEL read committed READ WRITE");
  }

  async commit() {
    if (!this.open)
      throw new Error(`Work is already closed`);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.client!.query("COMMIT");
    this.client.updateRefcount(-1);
  }

  sql(strings: TemplateStringsArray, ...values: unknown[]) {
    return (new SQLStatement(strings, values)).execute();
  }
}

class SQLStatement {
  statement: string;
  values: unknown[];

  constructor(strings: TemplateStringsArray, values: unknown[]) {
    this.statement = strings.reduce((prev, curr, i) => prev + '$' + i + curr);
    this.values = values;
  }

  async execute() {
    const client = await ensureConnection();
    const result = await client.query(this.statement, this.values);
    return result.rows;
  }
}

export async function beginWork(): Promise<Work> {
  const work = new Work(await ensureConnection());
  await work._beginTransaction();
  return work;

}

/** Build a SQL statement and execute it imediately */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return (new SQLStatement(strings, values)).execute();
}

/** Build a SQL statement for preparation or later execution */
export function prepare(strings: TemplateStringsArray, ...values: unknown[]) {
  return new SQLStatement(strings, values);
}
