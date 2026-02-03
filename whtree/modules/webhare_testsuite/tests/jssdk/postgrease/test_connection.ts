import * as test from "@webhare/test-backend";
import { connect, bindParam } from "@webhare/postgrease";


async function testConn() {
  const pgclient = await connect({
    port: parseInt(process.env.PGPORT!) || 5432,
    host: (process.env.WEBHARE_PGHOST ?? process.env.PGHOST) || "",
    user: "postgres",
    database: process.env.WEBHARE_DBASENAME || "",
  });

  const defaultCodecRegistry = pgclient["queryInterface"].defaultCodecRegistry;

  // Simple query, once and again to test cached description
  for (let i = 0; i < 2; ++i) {
    const res = await pgclient.query(`SELECT 1 + 1 as two`, []);
    test.eq({
      rows: [{ two: 2 }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "two", dataTypeId: 23, codec: defaultCodecRegistry.getCodec(23) }]
    }, res);
  }

  for (let i = 0; i < 2; ++i) {
    const res = await pgclient.query(`SELECT $1 as param`, [1]); // parsed as int2
    test.eq({
      rows: [{ param: 1 }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "param", dataTypeId: 21, codec: defaultCodecRegistry.getCodec("int2") }]
    }, res);
  }

  // With unknown param type, should not cache description
  for (let i = 0; i < 2; ++i) {
    const res = await pgclient.query(`SELECT $1 as param`, [null]); // param type parsed by PG as text
    test.eq({
      rows: [{ param: null }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "param", dataTypeId: 25, codec: defaultCodecRegistry.getCodec("text") }]
    }, res);
  }

  {
    // Test if empty
    const res = await pgclient.query(`SELECT $1 as c1, $2 as C2, $3 as c3`, [1, [], [null, null]]);
    test.eq({
      rows: [{ c1: 1, c2: [], c3: [null, null] }],
      rowCount: 1,
      command: "SELECT",
      fields: [
        { fieldName: "c1", dataTypeId: 21, codec: defaultCodecRegistry.getCodec("int2") },
        { fieldName: "c2", dataTypeId: 1009, codec: defaultCodecRegistry.getCodec("_text") },
        { fieldName: "c3", dataTypeId: 1009, codec: defaultCodecRegistry.getCodec("_text") },
      ]
    }, res);
  }

  {
    // Test bindparam
    const res = await pgclient.query(`SELECT $1 as c1`, [bindParam([], "_int4")]);
    test.eq({
      rows: [{ c1: [] }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "c1", dataTypeId: 1007, codec: defaultCodecRegistry.getCodec("_int4") },]
    }, res);
  }

  // Test if parameterstatus messages don't crash the query engine
  {
    const res = await pgclient.query(`SET application_name TO 'Something else'`, []);
    test.eq({
      rows: [],
      rowCount: 0,
      command: "SET",
      fields: [],
    }, res);
  }

  // STORY: concurrently fired queries
  {
    const app_name_query = await pgclient.query(`/*1*/SELECT name, setting FROM pg_settings WHERE name = 'application_name' LIMIT 1`);
    test.eq(1, app_name_query.rows.length);


    const pq1 = pgclient.query(`SELECT name, setting FROM pg_settings WHERE name = 'application_name' LIMIT 1`);
    const pq2 = pgclient.query(`SELECT name, setting FROM pg_settings WHERE name = 'application_name' LIMIT 1`);
    const pq3 = pgclient.query(`/*1*/SELECT name, setting FROM pg_settings WHERE name = $1 LIMIT 1`, ["application_name"]);
    const pq4 = pgclient.query(`/*2*/SELECT name, setting FROM pg_settings WHERE name = $1 LIMIT 1`, ["application_name"]);

    const q1 = await pq1;
    const q2 = await pq2;
    const q3 = await pq3;
    const q4 = await pq4;

    test.eqPartial({
      q1: { rows: app_name_query.rows },
      q2: { rows: app_name_query.rows },
      q3: { rows: app_name_query.rows },
      q4: { rows: app_name_query.rows },
    }, {
      q1,
      q2,
      q3,
      q4,
    });
  }

  const runPassthroughQuery = (b: Buffer | AsyncIterable<Buffer>,) => new Promise<Buffer>((resolve, reject) => {
    const responses: Buffer[] = [];
    pgclient.passthroughQuery(b, (data) => {
      if (data instanceof Error) {
        reject(data);
      } else if (data === null) {
        resolve(Buffer.concat(responses));
      } else {
        responses.push(data);
      }
    });
  });

  // STORY: passthrough query, 1 buffer
  {
    const queryPackets = Buffer.from("50000000100073656c6563742031000000420000000e0000000000000001000144000000065000450000000900000000005300000004", "hex");
    const responses = await runPassthroughQuery(queryPackets);
    test.eq(
      "3100000004" + // ParseComplete
      "3200000004" + // BindComplete
      "540000002100013f636f6c756d6e3f00000000000000000000170004ffffffff0001" + // RowDescription
      "440000000e00010000000400000001" + // DataRow
      "430000000d53454c454354203100" + // CommandComplete
      "5a0000000549", // Sync
      responses.toString("hex"));
  }

  // STORY: passthrough query, async iterable
  {
    async function* queryPackets() {
      yield Buffer.from("50000000100073656c6563742031000000", "hex");
      yield Buffer.from("420000000e00000000000000010001", "hex");
      yield Buffer.from("44000000065000", "hex");
      yield Buffer.from("45000000090000000000", "hex");
      yield Buffer.from("5300000004", "hex");
    }

    const responses = await runPassthroughQuery(queryPackets());
    test.eq(
      "3100000004" + // ParseComplete
      "3200000004" + // BindComplete
      "540000002100013f636f6c756d6e3f00000000000000000000170004ffffffff0001" + // RowDescription
      "440000000e00010000000400000001" + // DataRow
      "430000000d53454c454354203100" + // CommandComplete
      "5a0000000549", // Sync
      responses.toString("hex"));
  }

  async function* makeItr<T>(...buffers: T[]) { for (const buffer of buffers) yield buffer; }

  // STORY: passthrough query with incomplete packet
  {
    const tooShortBuffer = Buffer.from("50000000100073656c6563742031", "hex");
    const invalidHeaderBuffer = Buffer.from("50000000100073656c656374203100000042", "hex");

    await test.throws(/Invalid packet length/, runPassthroughQuery(tooShortBuffer));
    await test.throws(/Invalid packet length/, runPassthroughQuery(makeItr(tooShortBuffer)));
    await test.throws(/Invalid packet header in passthrough query packets/, runPassthroughQuery(invalidHeaderBuffer));
    await test.throws(/Invalid packet header in passthrough query packets/, runPassthroughQuery(makeItr(invalidHeaderBuffer)));

    // SUBSTORY: Connection still works after passthrough query error (that didn't write yet)
    const res = await pgclient.query(`SELECT 1 + 1 as two`, []);
    test.eq({
      rows: [{ two: 2 }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "two", dataTypeId: 23, codec: defaultCodecRegistry.getCodec(23) }]
    }, res);
  }

  // STORY: passthrough query with async iterator with second buffer invalid
  {
    const validBuffer = Buffer.from("50000000100073656c6563742031000000", "hex");
    const invalidBuffer = Buffer.from("42", "hex");

    await test.throws(/Invalid packet header in passthrough query packets/, runPassthroughQuery(makeItr(validBuffer, invalidBuffer)));

    // SUBSTORY: Connection still works after passthrough query error (that didn't write yet)
    const res = await pgclient.query(`SELECT 1 + 1 as two`, []);
    test.eq({
      rows: [{ two: 2 }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "two", dataTypeId: 23, codec: defaultCodecRegistry.getCodec(23) }]
    }, res);
  }

  await pgclient.close();
}

test.runTests([testConn,]);
