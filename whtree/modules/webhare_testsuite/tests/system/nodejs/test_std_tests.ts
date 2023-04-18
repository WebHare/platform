/*
To test for the backend (faster!):
wh runtest system.nodejs.test_std_api

In the browser:
wh runtest system.nodejs.test_std_frontend
*/

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

function testValue(decoded: string, encoded: string) {
  test.eq(encoded, std.encodeString(decoded, 'attribute'));
  test.eq(decoded, std.decodeString(encoded, 'attribute'));

  //ensure any JS replaces are properly global
  test.eq(encoded + "." + encoded, std.encodeString(decoded + "." + decoded, 'attribute'));
  test.eq(decoded + "." + decoded, std.decodeString(encoded + "." + encoded, 'attribute'));
}

function testHTML(decoded: string, encoded: string) {
  test.eq(encoded, std.encodeString(decoded, 'html'));
  test.eq(decoded, std.decodeString(encoded, 'html'));

  //ensure any JS replaces are properly global
  test.eq(encoded + "." + encoded, std.encodeString(decoded + "." + decoded, 'html'));
  test.eq(decoded + "." + decoded, std.decodeString(encoded + "." + encoded, 'html'));
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

  testValue("blabla", "blabla");
  testValue("\nd\t", "&#10;d&#9;");
  testValue("", "");
  testValue("\u01E5", "&#485;");
  testValue("<&>", "&lt;&amp;&gt;");
  testValue("hey blaat", "hey blaat");
  test.eq("hey", std.encodeString("\x04hey\x05", "attribute"));
  test.eq("heylaat", std.encodeString("hey\blaat", "attribute"));
  test.eq("<&>", std.decodeString("&#60;&#38;&#62;", "attribute"));
  test.eq("<br>", std.decodeString("<br>", "attribute"));
  test.eq("<br/>", std.decodeString("<br/>", "attribute"));
  test.eq("<br />", std.decodeString("<br />", "attribute"));

  testHTML("blabla", "blabla");
  testHTML("\nd\t", "<br>d&#9;");
  testHTML("", "");
  testHTML("\u01E5", "&#485;");
  testHTML("<&>", "&lt;&amp;&gt;");
  testHTML("hey blaat", "hey blaat");

  test.eq("hey", std.encodeString("\x04hey\x05", "html"));
  test.eq("heylaat", std.encodeString("hey\blaat", "html"));
  test.eq("<&>", std.decodeString("&#60;&#38;&#62;", "html"));
  test.eq("\n", std.decodeString("<br />", "html"), "Verify HareScript's <br /> is decoded");
  test.eq("\n", std.decodeString("<br>", "html"), "Verify our <br> is decoded");
  //TODO strip all html, HS DecodeHTML learned that too?
}

async function testCollections() {
  const map = new Map<string, number>();
  await test.throws(/Key not found and no insert handler provided/, () => std.emplace(map, "A"));
  test.eq(1, std.emplace(map, "A", { insert: () => 1, update: n => n + 1 }));
  test.eq(1, map.get("A"));
  test.eq(2, std.emplace(map, "A", { insert: () => 1, update: n => n + 1 }));

  const map2 = new Map<string | symbol, unknown>();
  test.eq("Horse", std.emplace(map2, Symbol(), { insert: () => "Horse" }));
}

async function testPromises() {
  const aborter = new AbortController; //to make sure our tests don't hang on the unresolved sleep
  await std.wrapInTimeout(std.sleep(1), 10000, new Error("Should not timeout"));
  // various ways to create an error:
  await test.throws(/oepsie/, std.wrapInTimeout(std.sleep(60000, { signal: aborter.signal }), 1, "oepsie"));
  await test.throws(/oepsie/, std.wrapInTimeout(std.sleep(60000, { signal: aborter.signal }), 1, new Error("oepsie")));
  await test.throws(/oepsie/, std.wrapInTimeout(std.sleep(60000, { signal: aborter.signal }), 1, () => "oepsie"));
  await test.throws(/oepsie/, std.wrapInTimeout(std.sleep(60000, { signal: aborter.signal }), 1, () => new Error("oepsie")));
  aborter.abort();
}

const testlist = [
  "Basic API tests",
  testAPI,
  "Crypto and strings",
  testStrings,
  "Collections",
  testCollections,
  "Promises",
  testPromises
];

export default testlist;
