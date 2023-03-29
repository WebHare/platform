import * as test from "@webhare/test";
import * as std from "@webhare/std";
import * as api from "@webhare/std/api";

//Test helpers for building APIs
async function testAPI() {
  //convertWaitPeriodToDate
  test.eq(-864000 * 1000 * 10000000, api.convertWaitPeriodToDate(0).getTime(), "minimum date");
  test.eq(864000 * 1000 * 10000000, api.convertWaitPeriodToDate(Infinity).getTime(), "maximum date");

  const now = Date.now(), soon = api.convertWaitPeriodToDate(100);
  test.assert(now <= soon.getTime() && soon.getTime() <= now + 1000);

  await test.throws(/Invalid wait duration/, () => api.convertWaitPeriodToDate(-1));
  await test.throws(/Invalid wait duration/, () => api.convertWaitPeriodToDate(7 * 86400 * 1000 + 1));
  await test.throws(/Invalid wait duration/, () => api.convertWaitPeriodToDate(Date.now()));
}

function testUFS(decoded: string, encoded: string) {
  test.eq(encoded, std.encodeString(decoded, 'base64url'));
  test.eq(decoded, std.decodeString(encoded, 'base64url'));
}

async function testStrings() {
  for (let i = 0; i < 100; ++i) {
    const id = std.generateRandomId(); //by default this generated 128bit base64url (UFS) encoded strings
    test.eqMatch(/^[-_0-9A-Za-z]{21}[QAwg]$/, id, `Failed: ${id}`);
  }

  for (let i = 0; i < 100; ++i) {
    const id = std.generateRandomId("hex");
    test.eqMatch(/^[0-9a-f]{32}$/, id, `Failed: ${id}`);
  }

  test.eqMatch(/^[0-9a-f]{8}$/, std.generateRandomId("hex", 4));
  test.eqMatch(/^[-_0-9A-Za-z]{4}$/, std.generateRandomId("base64url", 3));

  testUFS("Aladdin:open sesame", "QWxhZGRpbjpvcGVuIHNlc2FtZQ");
  testUFS("sysop:secret", "c3lzb3A6c2VjcmV0");
  testUFS("", "");
  testUFS("@", "QA");
  testUFS("\x3F\x3F\x3F", "Pz8_");
  testUFS("\x3E\x3E\x3E", "Pj4-");
  testUFS("\x3E\x3E", "Pj4");
}

const testlist = [
  "Basic API tests",
  testAPI,
  "Crypto and strings",
  testStrings
];

export default testlist;
