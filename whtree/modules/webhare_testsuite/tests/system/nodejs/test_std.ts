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
import "@webhare/deps/temporal-polyfill"; //required to run in the frontend

function testEnv() {
  test.eq(false, env.isLive);
  test.eq("development", env.dtapstage);
  test.eq("development", env.dtapStage);
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
  test.eq("Money", std.stdTypeOf(new Money));
  test.eq('"0"', JSON.stringify(new Money('-0')));
  test.eq('"0"', JSON.stringify(new Money('0')));
  test.eq(new Money("15.5"), new Money("15.50"));
  test.eq('"15.5"', JSON.stringify(new Money("15.50")));
  test.eq('"0.5"', JSON.stringify(new Money(".50")));
  test.eq('"1000000000"', JSON.stringify(new Money("1000000000")));
  test.eq('"-1000000000"', JSON.stringify(new Money("-1000000000")));
  test.eq('"1000000000"', JSON.stringify(Money.fromNumber(1_000_000_000)));
  test.eq('"-1000000000"', JSON.stringify(Money.fromNumber(-1_000_000_000)));
  test.throws(/Illegal money value/, () => new Money("test"));

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
  test.eq('"2.3"', JSON.stringify(Money.fromNumber(2.3000000000000003)));
  test.eq('"2.3"', JSON.stringify(Money.fromNumber(2.300004999999999)));
  test.eq('"2.30001"', JSON.stringify(Money.fromNumber(2.300005000000000)));
  test.eq('"2.30001"', JSON.stringify(Money.fromNumber(2.300009999999999)));
  test.eq('"-2.3"', JSON.stringify(Money.fromNumber(-2.300004999999999)));
  test.eq('"-2.30001"', JSON.stringify(Money.fromNumber(-2.300005000000000)));
  test.eq('"-2.30001"', JSON.stringify(Money.fromNumber(-2.300009999999999)));
  test.eq(new Money("2.3"), Money.fromNumber(2.3000000000000003));
  test.eq(2.25, Money.fromNumber(2.25).toNumber());
  test.eq(2.99999, new Money("2.99999").toNumber());

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
  testEqMoney("0.52", Money.add("0.50", "0", "0.02"));

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
  test.eq(new Date("2022-04-01"), std.addDuration(new Date("2022-04-02"), { sign: "-", days: 1 }));
  test.eq(new Date("1917-01-02T20:00:00Z"), std.addDuration(globalstamp, "PT55H25M4S"));
  test.eq(new Date("1918-01-02T20:00:00Z"), std.addDuration(globalstamp, "P365DT55H25M4S"));
  test.eq(new Date("1926-11-09T12:34:56Z"), std.addDuration(globalstamp, "P3600D"));
  test.eq(new Date("1916-12-31T12:34:56.789Z"), std.addDuration(globalstamp, "PT0.789S"));

  test.eq(new Date("2022-04-01"), std.subtractDuration(new Date("2022-04-02"), { days: 1 }));
  test.eq(new Date("2022-04-03"), std.subtractDuration(new Date("2022-04-02"), { sign: "-", days: 1 }));
  test.eq(new Date("1916-12-31T00:00:00Z"), std.subtractDuration(globalstamp, "PT12H34M56S"));
  test.eq(new Date("1915-12-31T00:00:00Z"), std.subtractDuration(globalstamp, "P366DT12H34M56S"));
  test.eq(new Date("1907-02-22T12:34:56Z"), std.subtractDuration(globalstamp, "P3600D"));
  test.eq(new Date("1916-12-31T12:34:55.211Z"), std.subtractDuration(globalstamp, "PT0.789S"));

  const testdate = std.addDuration(globalstamp, "PT0.123S");
  test.eq("1916-12-31T12:34:56.123Z", JSON.parse(std.stringify(testdate)));
  test.eq({ "$stdType": "Date", "date": "1916-12-31T12:34:56.123Z" }, JSON.parse(std.stringify(testdate, { typed: true })));
  test.eq(testdate, std.parseTyped(std.stringify(testdate, { typed: true })));

  //convertWaitPeriodToDate
  test.eq(-864000 * 1000 * 10000000, std.convertWaitPeriodToDate(0).getTime(), "minimum date");
  test.eq(864000 * 1000 * 10000000, std.convertWaitPeriodToDate(Infinity).getTime(), "maximum date");

  const now = Date.now(), soon = std.convertWaitPeriodToDate(100);
  test.assert(now <= soon.getTime() && soon.getTime() <= now + 1000);

  test.eq(new Date("2022-04-03T12:15:01Z"), std.convertWaitPeriodToDate(1000, { relativeTo: new Date("2022-04-03T12:15:00Z") }));
  test.eq(new Date("2022-04-04T12:15:00Z"), std.convertWaitPeriodToDate("P1D", { relativeTo: new Date("2022-04-03T12:15:00Z") }));
  test.eq(Temporal.Instant.from("2022-04-04T12:15:00Z"), std.convertWaitPeriodToDate("P1D", { relativeTo: Temporal.Instant.from("2022-04-03T12:15:00Z") }));

  test.eq(new Date("2022-04-04T12:15:00Z"), std.convertFlexibleInstantToDate(new Date("2022-04-04T12:15:00Z")));
  test.eq(new Date("2022-04-04T12:15:00Z"), std.convertFlexibleInstantToDate(Temporal.Instant.from("2022-04-04T12:15:00Z")));
  test.eq(new Date("2022-04-04T12:15:00Z"), std.convertFlexibleInstantToDate(Temporal.ZonedDateTime.from("2022-04-04T14:15:00[Europe/Amsterdam]")));

  test.throws(/Invalid wait duration/, () => std.convertWaitPeriodToDate(-1));

  const later = std.convertWaitPeriodToDate("P1DT5H"), estimate_later = Date.now() + 29 * 60 * 60 * 1000; //29 hours
  test.assert(estimate_later - 1000 <= later.getTime() && later.getTime() <= estimate_later + 1000);

  test.assert(std.isValidDate(2024, 12, 31));
  test.assert(std.isValidDate(2024, 1, 1));
  test.assert(std.isValidDate(2024, 2, 29));
  test.assert(std.isValidDate(1601, 2, 28));

  test.assert(!std.isValidDate(1600, 12, 31));
  test.assert(!std.isValidDate(2024, 12, 32));
  test.assert(!std.isValidDate(2023.5, 12, 31));
  test.assert(!std.isValidDate(2024, 11.25, 31));
  test.assert(!std.isValidDate(2024, 12, 30.222));
  test.assert(!std.isValidDate(999, 12, 31));
  test.assert(!std.isValidDate(99, 12, 31));
  test.assert(!std.isValidDate(1, 12, 31));
  test.assert(!std.isValidDate(-1, 12, 31));
  test.assert(!std.isValidDate(2024, 11, 31));
  test.assert(!std.isValidDate(2024, 0, 1));
  test.assert(!std.isValidDate(2025, 2, 29));
  test.assert(!std.isValidDate(2024, 2, 30));
  test.assert(!std.isValidDate(2024, NaN, 31));
  test.assert(!std.isValidDate(NaN, 12, 31));
  test.assert(!std.isValidDate(2024, 12, NaN));
  //@ts-expect-error TS doesn't like null either
  test.assert(!std.isValidDate(2024, 12, null));

  test.assert(std.isValidTime(23, 59, 59, 999));
  test.assert(std.isValidTime(0, 0, 0, 0));
  test.assert(!std.isValidTime(23, 59, 59, 1000));
  test.assert(!std.isValidTime(23, 59, 60, 0));
  test.assert(!std.isValidTime(0, 0, 0, -1));
  test.assert(!std.isValidTime(0, 0, 0, NaN));
  test.assert(!std.isValidTime(0, 0, NaN, 0));
  test.assert(!std.isValidTime(0, NaN, 0, 0));
  test.assert(!std.isValidTime(NaN, 0, 0, 0));
  //@ts-expect-error TS doesn't like null either
  test.assert(!std.isValidTime(null, 0, 0, 0));
  test.assert(!std.isValidTime(0, 0, 0, 0.5));
  test.assert(!std.isValidTime(0, 0, 0.5, 0));
  test.assert(!std.isValidTime(0, 0.5, 0, 0));
  test.assert(!std.isValidTime(0.5, 0, 0, 0));
}

function testFormatDateTime() {
  // test.eq("% Fri Friday Mar March 06 6 01 1 01 1 066 66 03 3 02 2 am 005 5 03 3 10 10 16 16 0916 916",
  //   std.formatDateTime("%% %a %A %b %B %d %#d %H %#H %I %#I %j %#j %m %#m %M %#M %p %Q %#Q %S %#S %V %#V %y %#y %Y %#Y", Temporal.Instant.from("0916-03-06T01:02:03.005Z")));
  test.eq("% Fri Friday Mar March 06 6 01 1 01 1 066 66 03 3 02 2 am 005 5 03 3 10 10 16 16 0916 916",
    std.formatDateTime("%% %a %A %b %B %d %#d %H %#H %I %#I %j %#j %m %#m %M %#M %p %Q %#Q %S %#S %V %#V %y %#y %Y %#Y", Temporal.ZonedDateTime.from("0916-03-06T01:02:03.005Z[UTC]")));

  //Ideally we wouldn't have 'am' here but the Intl library doesn't seem to have am/pm itself. anyway jp isn't that important to us right now
  test.eq("% 金 金曜日 3月 3月 06 6 01 1 01 1 066 66 03 3 02 2 am 005 5 03 3 10 10 16 16 0916 916",
    std.formatDateTime("%% %a %A %b %B %d %#d %H %#H %I %#I %j %#j %m %#m %M %#M %p %Q %#Q %S %#S %V %#V %y %#y %Y %#Y", Temporal.ZonedDateTime.from("0916-03-06T01:02:03.005Z[UTC]"), { locale: "ja-JP" }));
  test.eq("% ven. vendredi mars mars 06 6 01 1 01 1 066 66 03 3 02 2 am 005 5 03 3 10 10 16 16 0916 916",
    std.formatDateTime("%% %a %A %b %B %d %#d %H %#H %I %#I %j %#j %m %#m %M %#M %p %Q %#Q %S %#S %V %#V %y %#y %Y %#Y", Temporal.ZonedDateTime.from("0916-03-06T01:02:03.005Z[UTC]"), { locale: "fr" }));
  test.eq("% ma maandag mrt maart 06 6 18 18 06 6 | 065 65 03 3 02 2 pm | 005 5 03 3 10 10 95 95 1995 1995",
    std.formatDateTime("%% %a %A %b %B %d %#d %H %#H %I %#I | %j %#j %m %#m %M %#M %p | %Q %#Q %S %#S %V %#V %y %#y %Y %#Y", Temporal.ZonedDateTime.from("1995-03-06T17:02:03.005Z[Europe/Amsterdam]"), { locale: "nl" }));

  //TODO formatting plaindate and plaintime - should plaindate block any time specifiers or just stretch out to 000000 UTC ?
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

  test.assert(std.isValidUUID("f81d4fae-1234-11d0-a765-00a0c91e6bf6"));
  test.assert(std.isValidUUID("f81d4fae-1234-4444-a765-00a0c91e6bf6"));
  test.assert(std.isValidUUID("f81d4fae-1234-4444-a765-00a0c91e6bf6", "v4"));
  test.assert(!std.isValidUUID("f81d4fae-1234-4444-7765-00a0c91e6bf6", "v4"));
  test.assert(!std.isValidUUID("f81d4fae-1234-1111-a765-00a0c91e6bf6", "v4"));

  //@ts-expect-error TS knows v9 isn't supported
  test.throws(/Unsupported format.*v9/, () => std.isValidUUID("f81d4fae-1234-1111-a765-00a0c91e6bf6", "v9"));

  for (let i = 0; i < 100; ++i) {
    const id = std.generateRandomId("uuidv4", 16);
    test.assert(std.isValidUUID(id, 'v4'), `Failed: ${id}`);
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

  test.eq("http://beta.webhare.net/abcdef", std.joinURL("http://beta.webhare.net", "abcdef"));
  test.eq("http://beta.webhare.net/abcdef", std.joinURL("http://beta.webhare.net/", "abcdef"));
  test.eq("http://beta.webhare.net/abcdef", std.joinURL("http://beta.webhare.net", "/abcdef"));
  test.eq("http://beta.webhare.net/abcdef", std.joinURL("http://beta.webhare.net/", "/abcdef"));
  test.eq("http://beta.webhare.net/", std.joinURL("http://beta.webhare.net/", ""));
  test.eq("http://beta.webhare.net/", std.joinURL("http://beta.webhare.net", ""));
  test.eq("http://beta.webhare.net/", std.joinURL("http://beta.webhare.net", "/"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "../abcdef"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "./abcdef"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "/../abcdef"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "/./abcdef"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "x/../abcdef"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "x/./abcdef"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "/.."));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "//abcdef"));
  test.throws(/Invalid path/, () => std.joinURL("http://beta.webhare.net", "http://x.webhare.net"));
  test.eq("http://beta.webhare.net/.wh", std.joinURL("http://beta.webhare.net", ".wh"));
  test.eq("http://beta.webhare.net/.wh", std.joinURL("http://beta.webhare.net", "/.wh"));
  test.eq("http://beta.webhare.net/abcdef?../ghi", std.joinURL("http://beta.webhare.net/", "/abcdef?../ghi"));
  test.eq("http://beta.webhare.net/abcdef#../ghi", std.joinURL("http://beta.webhare.net/", "/abcdef#../ghi"));
  test.eq("http://beta.webhare.net/abcdef?//ghi", std.joinURL("http://beta.webhare.net/", "/abcdef?//ghi"));
  test.eq("http://beta.webhare.net/?http://example.net", std.joinURL("http://beta.webhare.net/", "?http://example.net"));

  test.eq("TéST0-9_()A", std.toCLocaleUppercase("tésT0-9_()a"));
  test.eq("tÉst0-9_()a", std.toCLocaleLowercase("TÉSt0-9_()A"));

  test.eq("\\*", std.escapeRegExp("*"));
  test.eq(".*", std.escapeRegExp("*", { wildcards: "?*" }));

  test.eq("^mask\\..*$", std.regExpFromWildcards("mask.*").source);
  test.eq("^(mask\\..*|optie.)$", std.regExpFromWildcards(["mask.*", "optie?"]).source);
  test.eq("", std.regExpFromWildcards(["mask.*", "optie?"]).flags);
  test.eq("i", std.regExpFromWildcards(["mask.*", "optie?"], { caseInsensitive: true }).flags);

  test.throws(/Empty mask list/, () => std.regExpFromWildcards([]), "We still need to determine what an empty mask list should return, so throw for now and let the caller deal with it");

  test.eq(4, std.getUTF8Length("Euro"));
  test.eq(5, std.getUTF8Length("Ëuro"));
  test.eq(6, std.getUTF8Length("€uro"));
  test.eq(4, std.getUTF8Length("🎉"));
  test.eq("E", std.limitUTF8Length("Euro", 1));
  test.eq("Eu", std.limitUTF8Length("Euro", 2));
  test.eq("Eur", std.limitUTF8Length("Euro", 3));
  test.eq("", std.limitUTF8Length("Ëuro", 1));
  test.eq("Ë", std.limitUTF8Length("Ëuro", 2));
  test.eq("Ëu", std.limitUTF8Length("Ëuro", 3));
  test.eq("", std.limitUTF8Length("€uro", 1));
  test.eq("", std.limitUTF8Length("€uro", 2));
  test.eq("€", std.limitUTF8Length("€uro", 3));
  test.eq("", std.limitUTF8Length("🎉", 1));
  test.eq("", std.limitUTF8Length("🎉", 2));
  test.eq("", std.limitUTF8Length("🎉", 3));
  test.eq("🎉", std.limitUTF8Length("🎉", 4));
}

async function testTypes() {
  const checkmatrix: Array<{ value: unknown; typedStringify?: boolean; stdType: ReturnType<typeof std.stdTypeOf>; quacks: Array<((x: unknown) => boolean)> }> = [
    { value: new Money("1.23"), stdType: "Money", quacks: [std.isMoney], typedStringify: true },
    { value: new Date, stdType: "Date", quacks: [std.isDate], typedStringify: true },
    { value: new Blob([]), stdType: "Blob", quacks: [std.isBlob] },
    { value: new File([], "file.txt"), stdType: "File", quacks: [std.isBlob, std.isFile] },
    { value: null, stdType: "null", quacks: [], typedStringify: true },
    { value: undefined, stdType: "undefined", quacks: [] },
    { value: [], stdType: "Array", quacks: [Array.isArray], typedStringify: true },
    { value: {}, stdType: "object", quacks: [], typedStringify: true },
    { value: { a: 42 }, stdType: "object", quacks: [], typedStringify: true },
    { value: JSON.parse(`{"a":43}`), stdType: "object", quacks: [], typedStringify: true },
    { value: new Error, stdType: "object", quacks: [std.isError] }, //we no (longer) have stdTypeOf Error detection
    { value: { "$stdType": "NotARealObject" }, stdType: "object", quacks: [] },
    { value: Temporal.Now.instant(), stdType: "Instant", quacks: [std.isTemporalInstant], typedStringify: true },
    { value: Temporal.Now.plainDate("iso8601"), stdType: "PlainDate", quacks: [std.isTemporalPlainDate], typedStringify: true },
    { value: Temporal.Now.plainDateTime("iso8601"), stdType: "PlainDateTime", quacks: [std.isTemporalPlainDateTime], typedStringify: true },
    { value: Temporal.Now.zonedDateTime("iso8601", "Europe/Amsterdam"), stdType: "ZonedDateTime", quacks: [std.isTemporalZonedDateTime], typedStringify: true },
  ];

  const allquacks = checkmatrix.reduce((acc, x) => acc.concat(x.quacks), [] as Array<(x: unknown) => boolean>);
  for (const [idx, row] of checkmatrix.entries()) {
    test.eq(row.stdType, std.stdTypeOf(row.value), `Row #${idx} - incorrect type`);
    for (const quack of allquacks) { //test the value against all quacks, ensure only the expected quacks succeed
      test.eq(row.quacks.includes(quack), quack(row.value), `Row #${idx} with type ${row.stdType} - quack test ${quack.name} failed`);
    }

    test.eq(row.value, row.value); //ensure the value is itself
    for (const [otheridx, otherrow] of checkmatrix.slice(0, idx).entries()) //we compare *up* to the current row
      test.throws(/.*/, () => test.eq(row.value, otherrow.value), `Row #${idx} (${row.stdType}) should not equal row #${otheridx} (${otherrow.stdType})`);

    if (row.typedStringify)
      test.eq(row.value, std.parseTyped(std.stringify(row.value, { typed: true })), `Row #${idx} with type ${row.stdType} - typed stringify/parse failed`);
  }

  test.eq({ "$stdType": "NotARealObject" }, JSON.parse(std.stringify({ "$stdType": "NotARealObject" })));
  test.throws(/Unrecognized type/, () => std.parseTyped(std.stringify({ "$stdType": "NotARealObject" })));
  test.throws(/already embedded '\$stdType'/, () => std.parseTyped(std.stringify({ "$stdType": "NotARealObject" }, { typed: true })));

  //Verify that the typed checks aren't confusing the stringifier for basic types
  for (const toStringify of [null, undefined, 42, "string", true, false, [42]]) {
    test.eq(JSON.stringify(toStringify), std.stringify(toStringify));
    test.eq(JSON.stringify(toStringify), std.stringify(toStringify, { typed: true }));
    test.eq(JSON.stringify(toStringify), std.stringify(toStringify, { stable: true }));
  }

  test.eq(JSON.stringify({ a: { b: 42 } }), std.stringify({ a: { b: 42 } }, { stable: true }));
  test.eq(std.stringify({ a1: { b1: 45, b2: 43 }, a2: 44 }, { stable: true }), std.stringify({ a2: 44, a1: { b2: 43, b1: 45 } }, { stable: true }));

  test.eq(`{"a":"</script>"}`, std.stringify({ a: "</script>" }));
  test.eq(`{"a":"</script>"}`, std.stringify({ a: "</script>" }, { target: "string" }));
  test.eq(`{"a":"<\\/script>"}`, std.stringify({ a: "</script>" }, { target: "script" }));
  test.eq(`{&quot;a&quot;:&quot;&lt;\\/script&gt;&quot;}`, std.stringify({ a: "</script>" }, { target: "attribute" }));
}

function testLevenstein() {
  test.eq(1, std.levenshteinDistance('a', 'b'));
  test.eq(1, std.levenshteinDistance('ab', 'ac'));
  test.eq(1, std.levenshteinDistance('ac', 'bc'));
  test.eq(1, std.levenshteinDistance('abc', 'axc'));
  test.eq(3, std.levenshteinDistance('kitten', 'sitting'));
  test.eq(6, std.levenshteinDistance('xabxcdxxefxgx', '1ab2cd34ef5g6'));
  test.eq(2, std.levenshteinDistance('cat', 'cow'));
  test.eq(6, std.levenshteinDistance('xabxcdxxefxgx', 'abcdefg'));
  test.eq(7, std.levenshteinDistance('javawasneat', 'scalaisgreat'));
  test.eq(3, std.levenshteinDistance('example', 'samples'));
  test.eq(6, std.levenshteinDistance('sturgeon', 'urgently'));
  test.eq(6, std.levenshteinDistance('levenshtein', 'frankenstein'));
  test.eq(5, std.levenshteinDistance('distance', 'difference'));
  test.eq(2, std.levenshteinDistance('因為我是中國人所以我會說中文', '因為我是英國人所以我會說英文'));
}

function testEmails() {
  const invalidEmails = [
    '"\u00E9" <rob@example.nl>',
    '"rob hul.swit"@example.nl',
    '"rob hulswit"@example.nl',
    '"rob\\ hul.swit"@example.nl',
    '"robh\\\nulswit@example.nl',
    '"robh\nulswit@example.nl',
    '"robhul\u0080.swit"@example.nl',
    '"robhul\u0080swit@example.nl',
    '"Tester, M." <marge@example.nl>',
    '\u00E9 <rob@example.nl>',
    '\u00E9 <rob@example.nl>',
    '<r\u00E9b@example.nl>',
    '<rob@b-l\u00E9x.nl>',
    '=?ISO-8859-1?Q?a?= <arnold@example.net>',
    '=?ISO-8859-1?Q?G.Gim=E9nez?= <arnold@example.net>',
    '=?ISO-8859-1?Q?Gim=E9nez?= <arnold@example.net>',
    '1234567890123456789012345678901234567890123456789012345678901234@1234567890123456789012345678901234567890123456789012345678901234.1234567890123456789012345678901234567890123456789012345678901234.12345678901234567890123456789012345678901234567890123456.net',  //254 is the absolute upper limit in SMTP
    '12345678901234567890123456789012345678901234567890123456789012345@example.net', //65 chars is not acceptable in RFC3696
    'r\u00E9b@example.nl',
    'Rob ( :( ) "Tester" <rob@example.nl>',
    'Rob (((x)) "Tester" <rob@example.nl>',
    'Rob (((x))) "Tester" <rob@example.nl>',
    'Rob ((x))) "Tester" <rob@example.nl>',
    'Rob (de wizard) "Test\\"er" <rob@example.nl>',
    'rob@b-l\u00E9x.nl',
    'ULFT. a_driever@example.com',
    " arnold@example.",
    "@example.com",
    "arnold@example.",
    "arnold@example.n.",
    "arnold@example.n", //might be RFC valid but there are no single character TLDs and this is very likely a 'too-fast-enter
    "arnold@example.nl.",
    "arnold@example.nl@example.com",
    "arnold@example",
  ];

  for (const email of invalidEmails)
    test.eq(false, std.isValidEmail(email), `Expected to be invalid: ${email}`);

  const validEmails = [
    '1234567890123456789012345678901234567890123456789012345678901234@1234567890123456789012345678901234567890123456789012345678901234.1234567890123456789012345678901234567890123456789012345678901234.1234567890123456789012345678901234567890123456789012345.net', //254 is the absolute upper limit in SMTP
    '1234567890123456789012345678901234567890123456789012345678901234@example.net',  //64 chars is on the edge of RFC3696 acceptable..
    "arnold@example.nl",
    "o`'^neill@example.com", //according to the MDN RegEx on https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/email
  ];

  for (const email of validEmails)
    test.eq(true, std.isValidEmail(email), `Expected to be valid: ${email}`);
}

function testUrls() {
  const validUrls = [
    "http://nu.nl/",
    "HtTp://nu.nl/",
    "http://nu.nl",
    "HtTp://nu.nl:65535/",
    "http://www.b-lex.com/",
    "http://www.b-lex.com/test/test",
    "https://www.b-lex.com/",
    "http://www.b-lex.com",
    "aaa:aa",
    "aaa:aa:aa",
    "aa-a:aa:aa",
    "http://aa:aa@www.b-lex.com/",
    "http://aa:aa:@www.b-lex.com/",
    "http://:aa@www.b-lex.com/",
    "http://aa:@www.b-lex.com/",
    "http://aa@www.b-lex.com:8000/",
  ];
  const invalidUrls = [
    "<URL:http://nu.nl/>",
    "<FTP:http://nu.nl/>",
    "http:nu.nl/",
    "http:nu.nl",
    "http:/nu.nl/",
    "http:/nu.nl",
    "http://nu.nl/\t",
    "http://nu.nl/met spatie",
    "http://nu.nl:65536/",
    "http://nu.nl:0/",
    "http:///",
    ":",
    "aaa",
    "aaa:",
    "aa_a:aa:aa",
    "http://aaa:aa:aa/",
    "http://aa@www.b-lex.com:xx/",
    "http://aa@www.b-lex.com:/",
    "http://",
  ];

  for (const url of validUrls)
    test.eq(true, std.isValidUrl(url), `testing valid url ${JSON.stringify(url)}`);
  for (const url of invalidUrls)
    test.eq(false, std.isValidUrl(url), `testing invalid url ${JSON.stringify(url)}`);
}

async function testCollections() {
  const map = new Map<string, number>();
  test.throws(/Key not found and no insert handler provided/, () => std.emplace(map, "A"));
  test.eq(1, std.emplace(map, "A", { insert: () => 1, update: n => n + 1 }));
  test.eq(1, map.get("A"));
  test.eq(2, std.emplace(map, "A", { insert: () => 1, update: n => n + 1 }));

  const map2 = new Map<string | symbol, unknown>();
  test.eq("Horse", std.emplace(map2, Symbol(), { insert: () => "Horse" }));

  const testobj = new File(["test!"], "test.txt");
  const weakmap3 = new WeakMap<File, string>;
  test.eq("testurl", std.emplace(weakmap3, testobj, { insert: () => "testurl" }));

  const array = [1, 2, 3, 4, 5];

  while (array[0] !== 5)
    std.shuffle(array);
  test.eq([1, 2, 3, 4, 5], array.sort()); //shouldn't sort() a number array as it'll do a string compare, but safe with numbers < 10

  const myarray: Array<Date | null> = [new Date, null];
  ///@ts-expect-error -- to show the point of IsTruthy - TS doesn't recognize this simple filter as eliminating falsy values
  myarray.filter(_ => _) satisfies Date[];
  myarray.filter(std.isTruthy) satisfies Date[];
  test.eq([myarray[0] as Date], myarray.filter(std.isTruthy));

  const bigArray: number[] = Array.from(Array(100000).keys());
  const biggerArray: number[] = [], hugeArray: number[] = [];
  //insert 10 times the bigArray into biggerArray, and then 10 times into hugeArray. a naive push() will stack overflow!
  for (let i = 0; i < 10; ++i)
    std.appendToArray(biggerArray, bigArray);
  for (let i = 0; i < 10; ++i)
    std.appendToArray(hugeArray, biggerArray);
  /* @ts-expect-error -- Don't let us add an incorrect array. Note that at runtime this works fine, it just breaks the type checks */
  std.appendToArray(hugeArray, ["big"]);
  test.eq(100000, bigArray.length);
  test.eq(1000000, biggerArray.length);
  test.eq(10000001, hugeArray.length);
  test.eq(5, hugeArray[100000 + 5]);
  test.eq(99999, hugeArray.at(-2));

  const typedEntriesA = std.typedEntries({ a: 1, b: "b" } as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  test.typeAssert<test.Equals<Array<["a", 1] | ["b", "b"]>, typeof typedEntriesA>>();
  test.typeAssert<test.Equals<["a", 1] | ["b", "b"], std.TypedEntries<{ a: 1; b: "b" }>>>();
  test.eq([["a", 1], ["b", "b"]], typedEntriesA);

  const typedKeysA = std.typedKeys({ a: 1, b: "b" }).toSorted((a, b) => a.localeCompare(b));
  test.typeAssert<test.Equals<Array<"a" | "b">, typeof typedKeysA>>();
  test.eq(["a", "b"] as const, typedKeysA);

  const typedFromEntriesA = std.typedFromEntries(typedEntriesA);
  test.typeAssert<test.Equals<{ a: 1; b: "b" }, typeof typedFromEntriesA>>();
  test.eq({ a: 1, b: "b" }, typedFromEntriesA);
  const typedFromEntriesB = std.typedFromEntries([["a", 1], ["b" as const, 2 as const]]);
  test.typeAssert<test.Equals<{ [x: string]: number }, typeof typedFromEntriesB>>();
  test.eq({ a: 1, b: 2 }, typedFromEntriesB);
}

async function testSortedSetMap() {
  // List (sorted on 'a', then 'b')
  const multimap1 = new std.SortedMultiMap(std.compareProperties(["a", "b"]), std.shuffle([
    [{ a: 1, b: 10 }, ["value 1"]],
    [{ a: 3, b: 1 }, ["second value"]],
    [{ a: 3, b: 1 }, ["second value, again"]],
    [{ a: 3, b: 3 }, ["value 3"]],
    [{ a: 5, b: 7 }, ["last value"]]
  ]));

  const multiset1 = new std.SortedMultiSet(std.compareProperties(["a", "b"]), std.shuffle([
    { a: 1, b: 10 },
    { a: 3, b: 1 },
    { a: 3, b: 1 },
    { a: 3, b: 3 },
    { a: 5, b: 7 }
  ]));


  // console.log(multimap1.lowerBound({ a: 1 }));
  // console.log(multimap1.upperBound({ a: 1 }));
  // console.log(multimap1.lowerBound({ a: 3 }));
  // console.log(multimap1.upperBound({ a: 3 }));

  // throw 1;

  test.eq(5, multimap1.size);
  test.eq(5, multiset1.size);

  test.eq([{ a: 1, b: 10 }, ["value 1"]], multimap1.at(0));
  test.eq({ a: 1, b: 10 }, multiset1.at(0));

  test.eq([{ a: 5, b: 7 }, ["last value"]], multimap1.at(-1));
  test.eq({ a: 5, b: 7 }, multiset1.at(-1));

  test.eq({ present: true, index: 1 }, multimap1.lowerBound({ a: 3, b: 1 }));
  test.eq({ present: true, index: 1 }, multiset1.lowerBound({ a: 3, b: 1 }));

  test.eq({ present: false, index: 5 }, multimap1.lowerBound({ a: 5, b: 8 }));
  test.eq({ present: false, index: 5 }, multiset1.lowerBound({ a: 5, b: 8 }));

  test.eq({ present: false, index: 0 }, multimap1.lowerBound({ a: 1, b: 8 }));
  test.eq({ present: false, index: 0 }, multiset1.lowerBound({ a: 1, b: 8 }));

  // @ts-expect-error -- Used key that doesn't exist in list.
  test.throws(/Property 'b' does not exist/, () => multimap1.lowerBound({ a: 1 }));
  // @ts-expect-error -- Used key that doesn't exist in set.
  test.throws(/Property 'b' does not exist/, () => multiset1.lowerBound({ a: 1 }));

  // @ts-expect-error -- but not when searchrecord is known and key doesn't exist there.
  test.throws(/Property 'b' does not exist/, () => multimap1.lowerBound({ a: 3 }));
  // @ts-expect-error -- but not when searchrecord is known and key doesn't exist there.
  test.throws(/Property 'b' does not exist/, () => multiset1.lowerBound({ a: 3 }));

  test.eq(1, multimap1.upperBound({ a: 1, b: 10 }));
  test.eq(1, multiset1.upperBound({ a: 1, b: 10 }));

  test.eq(3, multimap1.upperBound({ a: 3, b: 1 }));
  test.eq(3, multiset1.upperBound({ a: 3, b: 1 }));

  test.eq(5, multimap1.upperBound({ a: 5, b: 8 }));
  test.eq(5, multiset1.upperBound({ a: 5, b: 8 }));

  test.eq(0, multimap1.upperBound({ a: 1, b: 8 }));
  test.eq(0, multiset1.upperBound({ a: 1, b: 8 }));

  test.eq(multimap1.slice(0, 1), multimap1.sliceRange({ a: 1, b: 10 }));
  test.eq(multiset1.slice(0, 1), multiset1.sliceRange({ a: 1, b: 10 }));
  test.eq(multimap1.slice(1, 3), multimap1.sliceRange({ a: 3, b: 1 }));
  test.eq(multiset1.slice(1, 3), multiset1.sliceRange({ a: 3, b: 1 }));

  test.eq([], multimap1.sliceRange({ a: 5, b: 8 }));
  test.eq([], multiset1.sliceRange({ a: 5, b: 8 }));
  test.eq([], multimap1.sliceRange({ a: 1, b: 8 }));
  test.eq([], multiset1.sliceRange({ a: 1, b: 8 }));

  test.eq(multimap1.slice(0, 1), [...multimap1.rangeIterator({ a: 1, b: 10 })]);
  test.eq(multiset1.slice(0, 1), [...multiset1.rangeIterator({ a: 1, b: 10 })]);
  test.eq(multimap1.slice(1, 3), [...multimap1.rangeIterator({ a: 3, b: 1 })]);
  test.eq(multiset1.slice(1, 3), [...multiset1.rangeIterator({ a: 3, b: 1 })]);
  test.eq([], [...multimap1.rangeIterator({ a: 5, b: 8 })]);
  test.eq([], [...multiset1.rangeIterator({ a: 5, b: 8 })]);
  test.eq([], [...multimap1.rangeIterator({ a: 1, b: 8 })]);
  test.eq([], [...multiset1.rangeIterator({ a: 1, b: 8 })]);

  const multimap2 = new std.SortedMultiMap(std.compare, std.shuffle([[1, "One"], [2, "Two"], [3, "Three"], [4, "Four"], [5, "Five"], [6, "Six"], [7, "Seven"]]));
  const multiset2 = new std.SortedMultiSet(std.compare, std.shuffle([1, 2, 3, 4, 5, 6, 7]));

  multimap2.delete(3);
  multiset2.delete(3);
  test.eq(4, multimap2.add(5, "Another five"));
  test.eq(4, multiset2.add(5));

  test.eq([[1, "One"], [2, "Two"], [4, "Four"], [5, "Five"], [5, "Another five"], [6, "Six"], [7, "Seven"]], multimap2.slice(0, Infinity));
  test.eq([1, 2, 4, 5, 5, 6, 7], multiset2.slice(0, Infinity));

  multimap2.clear();
  test.eq(0, multimap2.size);
  multiset2.clear();
  test.eq(0, multiset2.size);
}

class TestClass {
  counter = 0;
  coalesceCalls = 0;

  constructor() {
    this.toSerialize = std.wrapSerialized(this.toSerialize.bind(this));
    this.toCoalesce = std.wrapSerialized(this.toCoalesce.bind(this), { coalesce: true });
  }

  /* @serialize */ async toSerialize(delay: number) {
    const currentcounter = this.counter;
    await std.sleep(delay >= 0 ? delay : 1);
    if (delay < 0)
      throw new Error("Threw at " + currentcounter);
    test.eq(currentcounter, this.counter, "Only we should increment it");
    return ++this.counter;
  }

  /* @serialize({ coalesce: true }) */ async toCoalesce(retval: number) {
    ++this.coalesceCalls;
    return retval;
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

  //test coalescing
  const coalesce: Array<Promise<number>> = [];
  coalesce.push(tester.toCoalesce(1));
  coalesce.push(tester.toCoalesce(2));
  coalesce.push(tester.toCoalesce(3));

  await std.sleep(50);  //gives the coalesced call a chance t orun
  coalesce.push(tester.toCoalesce(4));
  coalesce.push(tester.toCoalesce(5));

  test.eq([3, 3, 3, 5, 5], await Promise.all(coalesce));
  test.eq(2, tester.coalesceCalls);
}

async function testMutex() {
  const m = new std.LocalMutex();
  const l1 = await m.lock();
  const l2 = m.lock();
  const l3 = m.lock();

  {
    test.eq("Timeout", await Promise.race([l2, std.sleep(20).then(_ => "Timeout")]));
    l1.release();
    test.throws(/Lock already released/, () => l1.release());
    using l2lock = await l2;
    void (l2lock);
  }
  test.assert(await l3);
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

  test.eq({ "$stdType": "bigint", "bigint": "43" }, JSON.parse(std.stringify(43n, { typed: true })));
  test.eq(43n, std.parseTyped(std.stringify(43n, { typed: true })));
  test.eq(43n, std.parseTyped('{ "$stdType": "BigInt", "bigint": "43" }'), "Verify any pre-wh5.7 bigint doesn't break");
  test.eq({ deep: 44n, deeper: [45n] }, std.parseTyped(std.stringify({ deep: 44n, deeper: [45n] }, { typed: true })));
}

function testCompare() {
  test.eq(-1, std.compare(-1, 0));
  test.eq(-1, std.compare(-1, BigInt(0)));
  test.eq(-1, std.compare(-1, new Money("0")));
  test.eq(-1, std.compare(BigInt(-1), 0));
  test.eq(-1, std.compare(BigInt(-1), BigInt(0)));
  test.eq(-1, std.compare(BigInt(-1), new Money("0")));
  test.eq(-1, std.compare(new Money("-1"), 0));
  test.eq(-1, std.compare(new Money("-1"), BigInt("0")));
  test.eq(-1, std.compare(new Money("-1"), new Money("0")));
  test.eq(-1, std.compare(null, -1));
  test.eq(-1, std.compare(null, 0));
  test.eq(-1, std.compare(null, 1));
  test.eq(-1, std.compare(null, BigInt(-1)));
  test.eq(-1, std.compare(null, BigInt(0)));
  test.eq(-1, std.compare(null, BigInt(1)));
  test.eq(-1, std.compare(null, new Money("-1")));
  test.eq(-1, std.compare(null, new Money("0")));
  test.eq(-1, std.compare(null, new Money("1")));
  test.eq(-1, std.compare(null, new Date(-1)));
  test.eq(-1, std.compare(null, new Date(0)));
  test.eq(-1, std.compare(null, new Date(1)));
  test.eq(-1, std.compare("a", "b"));
  test.eq(-1, std.compare(new Date(1), new Date(2)));

  test.eq(0, std.compare(0, 0));
  test.eq(0, std.compare(0, BigInt(0)));
  test.eq(0, std.compare(0, new Money("0")));
  test.eq(0, std.compare(BigInt(0), 0));
  test.eq(0, std.compare(BigInt(0), BigInt(0)));
  test.eq(0, std.compare(BigInt(0), new Money("0")));
  test.eq(0, std.compare(new Money("0"), 0));
  test.eq(0, std.compare(new Money("0"), BigInt("0")));
  test.eq(0, std.compare(new Money("0"), new Money("0")));
  test.eq(0, std.compare(null, null));
  test.eq(0, std.compare("a", "a"));
  test.eq(0, std.compare(new Date(1), new Date(1)));

  test.eq(1, std.compare(0, -1));
  test.eq(1, std.compare(-1, null));
  test.eq(1, std.compare(0, null));
  test.eq(1, std.compare(1, null));
  test.eq(1, std.compare(0, BigInt(-1)));
  test.eq(1, std.compare(0, new Money("-1")));
  test.eq(1, std.compare(BigInt(0), -1));
  test.eq(1, std.compare(BigInt(-1), null));
  test.eq(1, std.compare(BigInt(0), null));
  test.eq(1, std.compare(BigInt(1), null));
  test.eq(1, std.compare(BigInt(0), BigInt(-1)));
  test.eq(1, std.compare(BigInt("0"), new Money("-1")));
  test.eq(1, std.compare(new Money("0"), -1));
  test.eq(1, std.compare(new Money("-1"), null));
  test.eq(1, std.compare(new Money("0"), null));
  test.eq(1, std.compare(new Money("1"), null));
  test.eq(1, std.compare(new Money("0"), BigInt(-1)));
  test.eq(1, std.compare(new Money("0"), new Money("-1")));
  test.eq(1, std.compare("b", "a"));
  test.eq(1, std.compare(new Date(2), new Date(1)));
  test.eq(1, std.compare(new Date(-1), null));
  test.eq(1, std.compare(new Date(0), null));
  test.eq(1, std.compare(new Date(1), null));

  test.eq(-1, std.compare(new Uint8Array([1, 2]), new Uint8Array([2, 1])));
  test.eq(0, std.compare(new Uint8Array([1, 2]), new Uint8Array([1, 2])));
  test.eq(1, std.compare(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])));

  if (typeof Buffer !== "undefined") { //looks like nodejs
    test.eq(-1, std.compare(Buffer.from("\x01\x02"), Buffer.from("\x02\x01")));
    test.eq(0, std.compare(Buffer.from("\x01\x02"), Buffer.from("\x01\x02")));
    test.eq(1, std.compare(Buffer.from("\x01\x02\x03"), Buffer.from("\x01\x02")));
  }

  const list = [
    { a: 1, b: 10, text: "value 1" },
    { a: 3, b: 1, text: "second value" },
    { a: 3, b: 1, text: "second value, again" },
    { a: 3, b: 3, text: "value 3" },
    { a: 5, b: 7, text: "last value" }
  ];

  const listDescOrder = [list[0], list[2], list[1], list[3], list[4]];

  test.eq(list, std.shuffle([...list]).toSorted(std.compareProperties(["a", "b", "text"])));
  test.eq(listDescOrder, std.shuffle([...list]).toSorted(std.compareProperties(["a", "b", ["text", "desc"]])));

  //@ts-expect-error TS also detects the incorrect property list
  test.throws(/Property 'text2' does not exist/, () => std.shuffle([...list]).toSorted(std.compareProperties(["a", "b", ["text2", "desc"]])));

  //Create partial comparator - FIXME validation - order & asc/desc must match exactly
  const topCompareFn = std.compareProperties(["a", "b", "text"]);
  const partialCompareFn = topCompareFn.partialCompare(["a", "b"]);
  test.eq([1, 3, 3, 3, 5], std.shuffle([...list]).toSorted(partialCompareFn).map(_ => _.a));

  // @ts-expect-error Key list must be a proper prefix of the original list
  void topCompareFn.partialCompare(["b"]);

  const keys: string[] = ["a"];
  const cmp = std.compareProperties(keys);
  // Properties are 'string', so this accepts a record with only comparable members
  test.throws(/Cannot compare/, () => cmp({ a: new Date }, { a: 1 }));
  // @ts-expect-error Record with non-comparable members are an error here
  test.throws(/Cannot compare/, () => cmp({ a: new Blob }, { a: 1 }));
}

function testCaseChanging() {
  test.eq("message_text", std.nameToSnakeCase("messageText"));
  test.eq("messageText", std.nameToCamelCase("message_text"));

  test.typeAssert<test.Equals<{ message_text: string }, std.ToSnakeCase<{ messageText: string }>>>();
  test.typeAssert<test.Equals<{ a_b: { c_d: string } }, std.ToSnakeCase<{ aB: { cD: string } }>>>();
  test.typeAssert<test.Equals<{ _a_b_c: string }, std.ToSnakeCase<{ ABC: string }>>>();
  test.typeAssert<test.Equals<{ messageText: string }, std.ToCamelCase<{ message_text: string }>>>();
  test.typeAssert<test.Equals<{ aB: { cD: string } }, std.ToCamelCase<{ a_b: { c_d: string } }>>>();

  const blobbie = new Blob(["test"], { type: "text/plain" });
  function verifyBlob(x: Blob) {
    return x.size === 4 && x.type === "text/plain" && std.isBlob(x);
  }

  test.eq({ message_text: "test" }, std.toSnakeCase({ messageText: "test" }));
  test.eq({ deep_array: [{ message_text: "abc" }, { message_text: "test", date_time: new Date("2024-01-01"), my_money: new Money("1.23"), my_blob: verifyBlob }] }, std.toSnakeCase({ deepArray: [{ messageText: "abc" }, { messageText: "test", dateTime: new Date("2024-01-01"), myMoney: new Money("1.23"), myBlob: blobbie }] }));
  test.eq({ messageText: "test" }, std.toCamelCase({ message_text: "test" }));
  test.eq({ deepArray: [{}, { messageText: "test", dateTime: new Date("2024-01-01"), myMoney: new Money("1.23"), myBlob: verifyBlob }] }, std.toCamelCase({ deep_array: [{}, { message_text: "test", date_time: new Date("2024-01-01"), my_money: new Money("1.23"), my_blob: blobbie }] }));

  const times = {
    date: new Date("2024-01-01T12:13:14Z"),
    instant: Temporal.Instant.from("2024-01-01T12:13:14Z"),
    zoned: Temporal.ZonedDateTime.from("2024-01-01T12:13:14[Europe/Amsterdam]"),
    plainDate: Temporal.PlainDate.from("2024-01-01"),
    plainDateTime: Temporal.PlainDateTime.from("2024-01-01T12:13:14"),
  };

  test.eq(times, std.toCamelCase(std.toSnakeCase(times)));
}

function testUUIDFallback() {
  //@ts-ignore - we explicitly want to break stuff so we can verify generateRandomId works without crypto.randomUUID (which is only available in secure contexts)
  crypto.randomUUID = undefined;
  test.assert(std.isValidUUID(std.generateRandomId("uuidv4", 16)));
}

async function testUtils() {
  test.eq("aborted", std.combineAbortSignals(AbortSignal.abort("aborted")).reason);
  test.eq("aborted", std.combineAbortSignals([null, undefined, AbortSignal.abort("aborted"), AbortSignal.abort("aborted2")]).reason);
  test.eq(undefined, std.combineAbortSignals([(async () => AbortSignal.abort("aborted"))()]).reason);
  test.eq("aborted", await new Promise<string>(r => {
    const signal = std.combineAbortSignals([(async () => AbortSignal.abort("aborted"))()]);
    signal.addEventListener("abort", () => r(signal.reason));
  }));

  let res: string | Error | undefined;
  std.whenAborted(AbortSignal.abort("aborted"), reason => res = reason);
  test.eq("aborted", res);
  std.whenAborted((async () => AbortSignal.abort("aborted2"))(), reason => res = reason);
  test.eq("aborted", res);
  await test.wait(() => res === "aborted2");
  const ac = new AbortController();
  std.whenAborted(ac.signal, reason => res = reason);
  ac.abort("aborted3");
  test.eq("aborted3", res);
  std.whenAborted(Promise.reject(new Error("boem")), reason => res = reason);
  await test.wait(() => res instanceof Error && res.message === "boem");

  const ac3 = new AbortController();
  std.whenAborted(AbortSignal.abort("aborted4"), ac3);
  test.eq("aborted4", ac3.signal.reason);
}


test.runTests([
  "@webhare/env",
  testEnv,
  "Money",
  testMoney,
  "Datetime",
  testDateTime,
  testFormatDateTime,
  "Crypto and strings",
  testStrings,
  testTypes,
  testLevenstein,
  testEmails,
  testUrls,
  "compare",
  testCompare,
  "Collections",
  testCollections,
  testSortedSetMap,
  "Promises",
  testPromises,
  "Mutex",
  testMutex,
  "BigInt",
  testBigInt,
  "testCaseChanging",
  testCaseChanging,
  ...(typeof window !== "undefined" ? [
    "UUID fallback",
    testUUIDFallback  //can't run on nodejs
  ] : []),
  "Utils",
  testUtils,
]);
