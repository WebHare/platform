import * as test from "@webhare/test-backend";
import { connect, bindParam } from "@webhare/postgrease";


async function testConn() {
  const pgclient = await connect({
    port: parseInt(process.env.PGPORT!) || 5432,
    host: (process.env.WEBHARE_PGHOST ?? process.env.PGHOST) || "",
    user: "postgres",
    database: process.env.WEBHARE_DBASENAME || "",
  });

  // Simple query, once and again to test cached description
  for (let i = 0; i < 2; ++i) {
    const res = await pgclient.query(`SELECT 1 + 1 as two`, []);
    test.eq({
      rows: [{ two: 2 }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "two", dataTypeId: 23, codec: pgclient["defaultCodecRegistry"].getCodec(23) }]
    }, res);
  }

  for (let i = 0; i < 2; ++i) {
    const res = await pgclient.query(`SELECT $1 as param`, [1]); // parsed as int2
    test.eq({
      rows: [{ param: 1 }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "param", dataTypeId: 21, codec: pgclient["defaultCodecRegistry"].getCodec("int2") }]
    }, res);
  }

  // With unknown param type, should not cache description
  for (let i = 0; i < 2; ++i) {
    const res = await pgclient.query(`SELECT $1 as param`, [null]); // param type parsed by PG as text
    test.eq({
      rows: [{ param: null }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ fieldName: "param", dataTypeId: 25, codec: pgclient["defaultCodecRegistry"].getCodec("text") }]
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
        { fieldName: "c1", dataTypeId: 21, codec: pgclient["defaultCodecRegistry"].getCodec("int2") },
        { fieldName: "c2", dataTypeId: 1009, codec: pgclient["defaultCodecRegistry"].getCodec("_text") },
        { fieldName: "c3", dataTypeId: 1009, codec: pgclient["defaultCodecRegistry"].getCodec("_text") },
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
      fields: [{ fieldName: "c1", dataTypeId: 1007, codec: pgclient["defaultCodecRegistry"].getCodec("_int4") },]
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

  // STORY: concurrently fired  queries
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
  await pgclient.close();
}

test.runTests([testConn,]);
