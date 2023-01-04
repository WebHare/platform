import * as test from "@webhare/test";
import { sql, beginWork } from "@webhare/whdb";

async function testQueries() {
  const work = await beginWork();
  await work.sql`DELETE FROM webhare_testsuite.exporttest`;
  await work.sql`INSERT INTO webhare_testsuite.exporttest(id,text) VALUES(${5},${"This is a text"})`;
  await work.commit();
  test.eq([{ id: 5, text: 'This is a text' }], await sql`SELECT * FROM webhare_testsuite.exporttest`);

  test.throws(/not reusable/, () => work._beginTransaction(), "verify that we can't restart work, even if we know about _beginTransaction");
}

test.run([testQueries]);
