/*
To test for the backend (faster!):
wh runtest system.nodejs.test_std_backend

In the browser:
wh runtest system.nodejs.test_std_frontend

This test also verifies that the base @ewbhare/test lib is compatible with frontend and backend
*/

import * as test from "@webhare/test";
import * as env from "@webhare/env";
import * as std from "@webhare/std";
import { Money } from "@webhare/std";

export const uuid4regex = new RegExp(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

function testEnv() {
  test.eq(false, env.isLive);
  test.eq("development", env.dtapstage);
}

function testRoundingCall(base: number, mode: std.MoneyRoundingMode, expect: number[]) {
  const mgot = [], mexpect = [];

  for (let i = -base; i <= base; ++i) {
    mexpect.push(Money.multiply(String(expect[i + base]), "0.1"));
    mgot.push(Money.roundToMultiple(Money.multiply(String(i), "0.1"), Money.multiply(String(base), "0.1"), mode));
  }

  test.eq(mexpect.join("_"), mgot.join("_"), `Rounding mode ${mode} for money`);
}

function testEqMoney(expect: string, actual: Money) {
  test.eq(new Money(expect), actual); //test.eq understands Money explicitly
}

function testMoney() {
  //test the constructor
  test.eq('"0"', JSON.stringify(new Money));
  test.eq('"0"', JSON.stringify(new Money('-0')));
  test.eq('"0"', JSON.stringify(new Money('0')));
  test.eq(new Money("15.5"), new Money("15.50"));
  test.eq('"15.5"', JSON.stringify(new Money("15.50")));
  test.eq('"0.5"', JSON.stringify(new Money(".50")));
  test.eq('"1000000000"', JSON.stringify(new Money("1000000000")));
  test.eq('"-1000000000"', JSON.stringify(new Money("-1000000000")));
  test.eq('"1000000000"', JSON.stringify(Money.fromNumber(1_000_000_000)));
  test.eq('"-1000000000"', JSON.stringify(Money.fromNumber(-1_000_000_000)));

  test.eq("-3.33", JSON.parse(std.stringify(new Money("-3.33"))));
  test.eq({ "$stdType": "Money", "money": "-3.33" }, JSON.parse(std.stringify(new Money("-3.33"), { typed: true })));
  testEqMoney("-3.33", std.parseTyped(std.stringify(new Money("-3.33"), { typed: true })));
  test.eq({ deep: new Money("-3.34"), deeper: { array: [new Money("-3.35")] } }, std.parseTyped(std.stringify({ deep: new Money("-3.34"), deeper: { array: [new Money("-3.35")] } }, { typed: true })));

  ///@ts-ignore -- we do not allow number casts as mixing number and Money may cause loss of precision/floating point decimal noise. verify runtime checks are in place
  test.throws(/Money cannot be constructed out of a value of type number/, () => new Money(0));
  ///@ts-ignore -- another throw check
  test.throws(/Money cannot be constructed out of a value of type number/, () => new Money(-1));
  test.throws(/Money value '1000000000000' is out of range/, () => new Money("1000000000000"));
  test.throws(/Money value '-1000000000000' is out of range/, () => new Money("-1000000000000"));
  //but it's okay to explicitly build from numbers
  test.eq('"15.5"', JSON.stringify(Money.fromNumber(15.5)));
  test.throws(/Money value '1000000000000' is out of range/, () => Money.fromNumber(1_000_000_000_000));
  test.throws(/Money value '-1000000000000' is out of range/, () => Money.fromNumber(-1_000_000_000_000));

  // testPresentation
  test.eq("0.00", new Money("0").format());
  test.eq("0,00", new Money("0").format({ decimalSeparator: "," }));
  test.eq("-2", new Money("-2").format({ minDecimals: 0 }));
  test.eq("-2.0", new Money("-2").format({ minDecimals: 1 }));
  test.eq("-2.1", new Money("-2.1").format({ minDecimals: 1 }));
  test.eq("-0.1", new Money("-0.1").format({ minDecimals: 1 }));
  test.eq("-0.01", new Money("-0.01").format({ minDecimals: 1 }));
  test.eq("1", new Money("1.0").format({ minDecimals: 0 }));
  test.eq("1.0", new Money("1.0").format({ minDecimals: 1 }));
  test.eq("1.01", new Money("1.01").format({ minDecimals: 0 }));
  test.eq("0.50", new Money("0.50").format());
  test.eq("119.50", new Money("119.5").format());
  test.eq("50000.00", new Money("50000").format());
  test.eq("50.000,00", new Money("50000").format({ decimalSeparator: ",", thousandsSeparator: "." }));
  test.eq("1.234,56", new Money("1234.56").format({ decimalSeparator: ",", thousandsSeparator: "." }));
  test.eq("12.345,67", new Money("12345.67").format({ decimalSeparator: ",", thousandsSeparator: "." }));
  test.eq("123,456.78", new Money("123456.78").format({ thousandsSeparator: "," }));
  test.eq("1'234'567.89", new Money("1234567.89").format({ thousandsSeparator: "'" }));
  test.eq("12 345 678:90", new Money("12345678.9").format({ thousandsSeparator: " ", decimalSeparator: ":" }));

  //TOO AS soon as we extend the maximum money range:
  // test.eq("1 222 333 444", new Money("1222333444").format({ thousandsSeparator: " ", decimalSeparator: ":", minDecimals: 0 }));

  // testAddition()
  testEqMoney("0.5", Money.add("0.50", "0"));
  testEqMoney("119.5", Money.add("119.00", "0.50"));

  // testMultiplicationAndPercentages()
  testEqMoney("415.5", Money.multiply("138.5", '3'));
  testEqMoney("-138.5", Money.multiply("138.5", '-1'));
  testEqMoney("5", Money.multiply("-5", '-1'));
  testEqMoney("0.145", Money.multiply("145", "0.001"));
  testEqMoney("-0.145", Money.multiply("-145", "0.001"));
  testEqMoney("0.0145", Money.multiply("14.5", "0.001"));
  testEqMoney("-0.0145", Money.multiply("-14.5", "0.001"));
  testEqMoney("0.00145", Money.multiply("1.45", "0.001"));
  testEqMoney("-0.00145", Money.multiply("-1.45", "0.001"));
  testEqMoney("0.00014", Money.multiply("0.144", "0.001"));
  testEqMoney("-0.00014", Money.multiply("-0.144", "0.001"));
  testEqMoney("0.00015", Money.multiply("0.145", "0.001"));
  testEqMoney("-0.00015", Money.multiply("-0.145", "0.001"));
  testEqMoney("0.00001", Money.multiply("0.0145", "0.001"));
  testEqMoney("-0.00001", Money.multiply("-0.0145", "0.001"));
  //must stay in safe range, so round 1.192992 to 1.19299
  testEqMoney("1.19299", Money.multiply("13.76", "0.0867"));
  testEqMoney("-1.19299", Money.multiply("-13.76", "0.0867"));

  testEqMoney("415.5", Money.getPercentage("138.5", "300"));
  testEqMoney("-138.5", Money.getPercentage("138.5", "-100"));
  testEqMoney("5", Money.getPercentage("-5", "-100"));
  testEqMoney("0.145", Money.getPercentage("145", "0.1"));
  testEqMoney("-0.145", Money.getPercentage("-145", "0.1"));
  testEqMoney("0.0145", Money.getPercentage("14.5", "0.1"));
  testEqMoney("-0.0145", Money.getPercentage("-14.5", "0.1"));
  testEqMoney("0.00145", Money.getPercentage("1.45", "0.1"));
  testEqMoney("-0.00145", Money.getPercentage("-1.45", "0.1"));
  testEqMoney("0.00014", Money.getPercentage("0.144", "0.1"));
  testEqMoney("-0.00014", Money.getPercentage("-0.144", "0.1"));
  testEqMoney("0.00015", Money.getPercentage("0.145", "0.1"));
  testEqMoney("-0.00015", Money.getPercentage("-0.145", "0.1"));
  testEqMoney("0.00001", Money.getPercentage("0.0145", "0.1"));
  testEqMoney("-0.00001", Money.getPercentage("-0.0145", "0.1"));
  //must stay in safe range, so round 1.192992 to 1.19299
  testEqMoney("1.19299", Money.getPercentage("13.76", "8.67"));
  testEqMoney("-1.19299", Money.getPercentage("-13.76", "8.67"));

  // testSubtraction()
  testEqMoney("-0.05", Money.subtract("4.95", '5'));

  // testComparison()
  test.eq(-1, Money.cmp("0.50", "1.50"));
  test.eq(0, Money.cmp("1.50", "1.50"));
  test.eq(1, Money.cmp("2.50", "1.50"));
  test.eq(1, Money.cmp("0.50", "0.0"));
  test.eq(-1, Money.cmp("-0.50", "0.00"));
  test.eq(-1, Money.cmp("0.0", "0.50"));
  test.eq(0, Money.cmp("-0", "0"));

  test.eq(false, Money.check("1", "<", "0"));
  test.eq(false, Money.check("1", "<", "1"));
  test.eq(true, Money.check("1", "<", "2"));

  test.eq(false, Money.check("1", "<=", "0"));
  test.eq(true, Money.check("1", "<=", "1"));
  test.eq(true, Money.check("1", "<=", "2"));

  test.eq(false, Money.check("1", "==", "0"));
  test.eq(true, Money.check("1", "==", "1"));
  test.eq(false, Money.check("1", "==", "2"));

  test.eq(true, Money.check("1", "!=", "0"));
  test.eq(false, Money.check("1", "!=", "1"));
  test.eq(true, Money.check("1", "!=", "2"));

  test.eq(true, Money.check("1", ">", "0"));
  test.eq(false, Money.check("1", ">", "1"));
  test.eq(false, Money.check("1", ">", "2"));

  test.eq(true, Money.check("1", ">=", "0"));
  test.eq(true, Money.check("1", ">=", "1"));
  test.eq(false, Money.check("1", ">=", "2"));

  // testRounding()
  //                                        -5  -4  -3  -2  -1  0  1  2  3  4  5
  testRoundingCall(5, "toward-zero", [-5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5]);
  testRoundingCall(5, "down", [-5, -5, -5, -5, -5, 0, 0, 0, 0, 0, 5]);
  testRoundingCall(5, "up", [-5, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5]);
  testRoundingCall(5, "half-toward-zero", [-5, -5, -5, 0, 0, 0, 0, 0, 5, 5, 5]);
  testRoundingCall(5, "half-down", [-5, -5, -5, 0, 0, 0, 0, 0, 5, 5, 5]);
  testRoundingCall(5, "half-up", [-5, -5, -5, 0, 0, 0, 0, 0, 5, 5, 5]);

  //                                        -6  -5  -4  -3  -2  -1  0  1  2  3  4  5  6
  testRoundingCall(6, "toward-zero", [-6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6]);
  testRoundingCall(6, "down", [-6, -6, -6, -6, -6, -6, 0, 0, 0, 0, 0, 0, 6]);
  testRoundingCall(6, "up", [-6, 0, 0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6]);
  testRoundingCall(6, "half-toward-zero", [-6, -6, -6, 0, 0, 0, 0, 0, 0, 0, 6, 6, 6]);
  testRoundingCall(6, "half-down", [-6, -6, -6, -6, 0, 0, 0, 0, 0, 0, 6, 6, 6]);
  testRoundingCall(6, "half-up", [-6, -6, -6, 0, 0, 0, 0, 0, 0, 6, 6, 6, 6]);

  // testMinMax()
  testEqMoney("3", Money.max("3"));
  testEqMoney("3", Money.max("3", "2"));
  testEqMoney("4", Money.max("3", "2", "4"));
  testEqMoney("4", Money.max("3", "2", "4", "1.5"));
  testEqMoney("4.5", Money.max("3", "2", "4", "1.5", "4.5"));

  testEqMoney("3", Money.min("3"));
  testEqMoney("2", Money.min("3", "2"));
  testEqMoney("2", Money.min("3", "2", "4"));
  testEqMoney("1.5", Money.min("3", "2", "4", "1.5"));
  testEqMoney("1.5", Money.min("3", "2", "4", "1.5", "4.5"));

  // testDivision()
  testEqMoney("0.33333", Money.divide("1", "3"));
  testEqMoney("-0.33333", Money.divide("-1", "3"));
  testEqMoney("0.66667", Money.divide("2", "3"));
  testEqMoney("-0.66667", Money.divide("-2", "3"));
  testEqMoney("0.00002", Money.divide("0.00150", "100"));
  testEqMoney("0.00001", Money.divide("0.00149", "100"));
  testEqMoney("5", Money.divide("100", "20"));
  testEqMoney("-0.00001", Money.divide("-5", "1000000"));
  testEqMoney("2", Money.divide("5", "2.5"));
  testEqMoney("10", Money.divide("5", "0.5"));
  testEqMoney("13.75998", Money.divide("1.19299", "0.0867"));
}

function testDateTime() {
  const globalstamp = new Date("1916-12-31T12:34:56Z"); // Sunday 31-12-1916 12:34:56
  const baseduration: std.Duration =
  {
    sign: "+",
    years: 0,
    months: 0,
    days: 0,
    weeks: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    milliseconds: 0
  };

  test.eq({ ...baseduration, years: 1 }, std.parseDuration("P1Y"));
  test.eq({ ...baseduration, sign: "-", years: 2 }, std.parseDuration("-P2Y"));
  test.eq({ ...baseduration, months: 1 }, std.parseDuration("P1M"));
  test.eq({ ...baseduration, days: 1 }, std.parseDuration("P1D"));
  test.eq({ ...baseduration, weeks: 1 }, std.parseDuration("P1W"));
  test.eq({ ...baseduration, hours: 1 }, std.parseDuration("PT1H"));
  test.eq({ ...baseduration, minutes: 1 }, std.parseDuration("PT1M"));
  test.eq({ ...baseduration, seconds: 1 }, std.parseDuration("PT1S"));
  test.eq({ ...baseduration, seconds: 1, milliseconds: 200 }, std.parseDuration("PT1.2S"));
  test.eq({ ...baseduration, seconds: 1, milliseconds: 1 }, std.parseDuration("PT1.0012S"));

  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("P1y"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("P1y"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("P1S"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("P-1S"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("PT"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("PD"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("P1W1D"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("+P1Y"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("aP1Y"));
  test.throws(/Invalid ISO8601 duration/, () => std.parseDuration("P1Yb"));

  test.eq(new Date("2022-04-03"), std.addDuration(new Date("2022-04-02"), { days: 1 }));
  test.eq(new Date("1917-01-02T20:00:00Z"), std.addDuration(globalstamp, "PT55H25M4S"));
  test.eq(new Date("1918-01-02T20:00:00Z"), std.addDuration(globalstamp, "P365DT55H25M4S"));
  test.eq(new Date("1926-11-09T12:34:56Z"), std.addDuration(globalstamp, "P3600D"));
  test.eq(new Date("1916-12-31T12:34:56.789Z"), std.addDuration(globalstamp, "PT0.789S"));

  const testdate = std.addDuration(globalstamp, "PT0.123S");
  test.eq("1916-12-31T12:34:56.123Z", JSON.parse(std.stringify(testdate)));
  test.eq({ "$stdType": "Date", "date": "1916-12-31T12:34:56.123Z" }, JSON.parse(std.stringify(testdate, { typed: true })));
  test.eq(testdate, std.parseTyped(std.stringify(testdate, { typed: true })));

  //convertWaitPeriodToDate
  test.eq(-864000 * 1000 * 10000000, std.convertWaitPeriodToDate(0).getTime(), "minimum date");
  test.eq(864000 * 1000 * 10000000, std.convertWaitPeriodToDate(Infinity).getTime(), "maximum date");

  const now = Date.now(), soon = std.convertWaitPeriodToDate(100);
  test.assert(now <= soon.getTime() && soon.getTime() <= now + 1000);

  test.throws(/Invalid wait duration/, () => std.convertWaitPeriodToDate(-1));
  test.throws(/Invalid wait duration/, () => std.convertWaitPeriodToDate(7 * 86400 * 1000 + 1));
  test.throws(/Invalid wait duration/, () => std.convertWaitPeriodToDate(Date.now()));

  const later = std.convertWaitPeriodToDate("P1DT5H"), estimate_later = Date.now() + 29 * 60 * 60 * 1000; //29 hours
  test.assert(estimate_later - 1000 <= later.getTime() && later.getTime() <= estimate_later + 1000);
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
    test.eq(/^[-_0-9A-Za-z]{21}[QAwg]$/, id, `Failed: ${id}`);
  }

  for (let i = 0; i < 100; ++i) {
    const id = std.generateRandomId("hex");
    test.eq(/^[0-9a-f]{32}$/, id, `Failed: ${id}`);
  }

  test.eq(/^[0-9a-f]{8}$/, std.generateRandomId("hex", 4));

  for (let i = 0; i < 100; ++i) {
    const id = std.generateRandomId("uuidv4", 16);
    test.eq(uuid4regex, id, `Failed: ${id}`);
  }

  test.throws(/16 bytes/, () => std.generateRandomId("uuidv4", 15));
  test.throws(/16 bytes/, () => std.generateRandomId("uuidv4", 17));

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
  testValue(`'"`, "&apos;&quot;");
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
  testHTML(`'"`, `'"`);

  test.eq("hey", std.encodeString("\x04hey\x05", "html"));
  test.eq("heylaat", std.encodeString("hey\blaat", "html"));
  test.eq("<&>", std.decodeString("&#60;&#38;&#62;", "html"));
  test.eq("\n", std.decodeString("<br />", "html"), "Verify HareScript's <br /> is decoded");
  test.eq("\n", std.decodeString("<br>", "html"), "Verify our <br> is decoded");
  //TODO strip all html, HS DecodeHTML learned that too?

  test.eq(JSON.stringify({ a: { b: 42 } }), std.stringify({ a: { b: 42 } }, { stable: true }));
  test.eq(std.stringify({ a1: { b1: 45, b2: 43 }, a2: 44 }, { stable: true }), std.stringify({ a2: 44, a1: { b2: 43, b1: 45 } }, { stable: true }));

  test.eq(`{"a":"</script>"}`, std.stringify({ a: "</script>" }));
  test.eq(`{"a":"</script>"}`, std.stringify({ a: "</script>" }, { target: "string" }));
  test.eq(`{"a":"<\\/script>"}`, std.stringify({ a: "</script>" }, { target: "script" }));
  test.eq(`{&quot;a&quot;:&quot;&lt;\\/script&gt;&quot;}`, std.stringify({ a: "</script>" }, { target: "attribute" }));

  test.eq({ "$stdType": "NotARealObject" }, JSON.parse(std.stringify({ "$stdType": "NotARealObject" })));
  test.throws(/Unrecognized type/, () => std.parseTyped(std.stringify({ "$stdType": "NotARealObject" })));
  test.throws(/already embedded '\$stdType'/, () => std.parseTyped(std.stringify({ "$stdType": "NotARealObject" }, { typed: true })));

  test.eq("ab", std.slugify("\x1Fab"));
  test.eq("a-b", std.slugify("a\u00A0b"));
  test.eq("uber-12-strassen", std.slugify(".Über '12' _Straßen_.?"));
  test.eq("uber+12+strassen", std.slugify(".Über '12' _Straßen_.?", { separator: '+' }));
  test.eq(null, std.slugify(":::"));
  test.eq("a-b", std.slugify("a:b"));
  test.eq("a-b", std.slugify(" a:b "));
  test.eq("ab", std.slugify(" a:b ", { separator: '' }));

  test.eq("indexhtml", std.slugify("^index.html", { separator: '' }));
  test.eq("index.html", std.slugify("^index.html", { keep: '.' }));
  test.eq("index.|+html", std.slugify("^index.|+html", { keep: '|+.' }));
  test.eq("^index.|+html", std.slugify("^index.|+html", { keep: '^|+.' }));
  test.eq("^index-html", std.slugify("^index.|+html", { keep: '^' }));
}

async function testCollections() {
  const map = new Map<string, number>();
  test.throws(/Key not found and no insert handler provided/, () => std.emplace(map, "A"));
  test.eq(1, std.emplace(map, "A", { insert: () => 1, update: n => n + 1 }));
  test.eq(1, map.get("A"));
  test.eq(2, std.emplace(map, "A", { insert: () => 1, update: n => n + 1 }));

  const map2 = new Map<string | symbol, unknown>();
  test.eq("Horse", std.emplace(map2, Symbol(), { insert: () => "Horse" }));

  // `Object.groupBy` groups items by arbitrary key.
  // In this case, we're grouping by even/odd keys
  const array = [1, 2, 3, 4, 5];
  test.eq({ odd: [1, 3, 5], even: [2, 4] }, std.objectGroupBy(array, (num, index) => {
    return num % 2 === 0 ? 'even' : 'odd';
  }));

  // `Map.groupBy` returns items in a Map, and is useful for grouping
  // using an object key.
  const odd = { odd: true };
  const even = { even: true };
  test.eq([[odd, [1, 3, 5]], [even, [2, 4]]], [
    ...std.mapGroupBy(array, (num, index) => {
      return num % 2 === 0 ? even : odd;
    }).entries()
  ]);

}


class TestClass {
  counter = 0;

  constructor() {
    ///@ts-ignore -- manually decorate our toSerialize call
    this.toSerialize = std.serialize(this.toSerialize.bind(this));
  }

  /* @serialize */ async toSerialize(delay: number) {
    const currentcounter = this.counter;
    await std.sleep(delay >= 0 ? delay : 1);
    if (delay < 0)
      throw new Error("Threw at " + currentcounter);
    test.eq(currentcounter, this.counter, "Only we should increment it");
    return ++this.counter;
  }
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

  //test serializer
  const tester = new TestClass;
  const call1 = tester.toSerialize(200);
  const call2 = tester.toSerialize(100);
  //test a throwing action not disrupting the rest of the queue
  const shouldthrow = tester.toSerialize(-1);
  const call3 = tester.toSerialize(0);

  await test.wait(() => tester.counter === 3);
  test.eq(1, await call1);
  test.eq(2, await call2);
  test.eq(3, await call3);

  await test.throws(/Threw at 2/, shouldthrow);
}

function testBigInt() {
  //This test requires compatibility=es2020. WebHare defaults to "es2016", "safari14" which triggers: 'Big integer literals are not available in the configured target environment'
  test.throws(/BigInt/, () => std.stringify({ a: { b: 42n } }, { stable: true }));
  test.eq(JSON.stringify({ a: { b: "42" } }), std.stringify({ a: { b: 42n } }, {
    stable: true,
    replacer: (k, v) => typeof v === "bigint" ? v.toString() : v
  }));
  test.eq(JSON.stringify({ a: { b: "42" } }, null, 2), std.stringify({ a: { b: 42n } }, {
    stable: true,
    replacer: (k, v) => typeof v === "bigint" ? v.toString() : v,
    space: 2
  }));

  test.eq({ "$stdType": "BigInt", "bigint": "43" }, JSON.parse(std.stringify(43n, { typed: true })));
  test.eq(43n, std.parseTyped(std.stringify(43n, { typed: true })));
  test.eq({ deep: 44n, deeper: [45n] }, std.parseTyped(std.stringify({ deep: 44n, deeper: [45n] }, { typed: true })));
}

function testUUIDFallback() {
  //@ts-ignore - we explicitly want to break stuff so we can verify generateRandomId works without crypto.randomUUID (which is only available in secure contexts)
  crypto.randomUUID = undefined;
  test.eq(uuid4regex, std.generateRandomId("uuidv4", 16));
}


test.run([
  "@webhare/env",
  testEnv,
  "Money",
  testMoney,
  "Datetime",
  testDateTime,
  "Crypto and strings",
  testStrings,
  "Collections",
  testCollections,
  "Promises",
  testPromises,
  "BigInt",
  testBigInt,
  ...(typeof navigator !== "undefined" ? [
    "UUID fallback",
    testUUIDFallback  //can't run on nodejs
  ] : [])
]);
