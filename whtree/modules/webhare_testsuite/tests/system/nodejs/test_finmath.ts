import * as finmath from "@mod-system/js/util/finmath";
import * as test from "@webhare/test";

//TODO swap the test.eq arguments...

// Keep in sync with test_numbers.whscr
function testRoundingCall(base: number, mode: finmath.RoundMode, expect: number[]) {
  const got = [], mgot = [], mexpect = [];

  for (let i = -base; i <= base; ++i) {
    mexpect.push(finmath.multiply(expect[i + base], "0.1"));
    got.push(finmath.__roundIntegerToMultiple(i, base, mode));
    mgot.push(finmath.roundToMultiple(finmath.multiply(i, "0.1"), finmath.multiply(base, "0.1"), mode));
  }

  test.eq(expect.join("_"), got.join("_"), `Rounding mode ${mode} for integer`);
  test.eq(mexpect.join("_"), mgot.join("_"), `Rounding mode ${mode} for money`);
}

function testPresentation() {
  test.eq(finmath.formatPrice(0, ".", 0), "0");
  test.eq(finmath.formatPrice("0", ".", 0), "0");
  test.eq(finmath.formatPrice("-0", ".", 0), "0");
  test.eq(finmath.formatPrice(-2, ".", 0), "-2");
  test.eq(finmath.formatPrice(-2, ".", 1), "-2.0");
  test.eq(finmath.formatPrice("-2.1", ".", 1), "-2.1");
  test.eq(finmath.formatPrice("-0.1", ".", 1), "-0.1");
  test.eq(finmath.formatPrice("-0.01", ".", 1), "-0.01");
  test.eq(finmath.formatPrice("1.0", ".", 0), "1");
  test.eq(finmath.formatPrice("1.0", ".", 1), "1.0");
  test.eq(finmath.formatPrice("1.01", ".", 0), "1.01");
  test.eq(finmath.formatPrice("0.50", ".", 2), "0.50");
  test.eq(finmath.formatPrice("119.5", ".", 2), "119.50");
}

function testAddition() {
  test.eq(finmath.add("0.50", 0), "0.5");
  test.eq(finmath.add("119.00", "0.50"), "119.5");
}

function testMultiplicationAndPercentages() {
  test.eq(finmath.multiply("138.5", 3), "415.5");
  test.eq(finmath.multiply("138.5", -1), "-138.5");
  test.eq(finmath.multiply("-5", -1), "5");
  test.eq(finmath.multiply("145", "0.001"), "0.145");
  test.eq(finmath.multiply("-145", "0.001"), "-0.145");
  test.eq(finmath.multiply("14.5", "0.001"), "0.0145");
  test.eq(finmath.multiply("-14.5", "0.001"), "-0.0145");
  test.eq(finmath.multiply("1.45", "0.001"), "0.00145");
  test.eq(finmath.multiply("-1.45", "0.001"), "-0.00145");
  test.eq(finmath.multiply("0.144", "0.001"), "0.00014");
  test.eq(finmath.multiply("-0.144", "0.001"), "-0.00014");
  test.eq(finmath.multiply("0.145", "0.001"), "0.00015");
  test.eq(finmath.multiply("-0.145", "0.001"), "-0.00015");
  test.eq(finmath.multiply("0.0145", "0.001"), "0.00001");
  test.eq(finmath.multiply("-0.0145", "0.001"), "-0.00001");
  test.eq(finmath.multiply("13.76", "0.0867"), "1.19299"); //must stay in safe range, so round 1.192992 to 1.19299
  test.eq(finmath.multiply("-13.76", "0.0867"), "-1.19299");
  test.eq(finmath.getPercentageOfAmount("138.5", 300), "415.5");
  test.eq(finmath.getPercentageOfAmount("138.5", -100), "-138.5");
  test.eq(finmath.getPercentageOfAmount("-5", -100), "5");
  test.eq(finmath.getPercentageOfAmount("145", "0.1"), "0.145");
  test.eq(finmath.getPercentageOfAmount("-145", "0.1"), "-0.145");
  test.eq(finmath.getPercentageOfAmount("14.5", "0.1"), "0.0145");
  test.eq(finmath.getPercentageOfAmount("-14.5", "0.1"), "-0.0145");
  test.eq(finmath.getPercentageOfAmount("1.45", "0.1"), "0.00145");
  test.eq(finmath.getPercentageOfAmount("-1.45", "0.1"), "-0.00145");
  test.eq(finmath.getPercentageOfAmount("0.144", "0.1"), "0.00014");
  test.eq(finmath.getPercentageOfAmount("-0.144", "0.1"), "-0.00014");
  test.eq(finmath.getPercentageOfAmount("0.145", "0.1"), "0.00015");
  test.eq(finmath.getPercentageOfAmount("-0.145", "0.1"), "-0.00015");
  test.eq(finmath.getPercentageOfAmount("0.0145", "0.1"), "0.00001");
  test.eq(finmath.getPercentageOfAmount("-0.0145", "0.1"), "-0.00001");
  test.eq(finmath.getPercentageOfAmount("13.76", "8.67"), "1.19299"); //must stay in safe range, so round 1.192992 to 1.19299
  test.eq(finmath.getPercentageOfAmount("-13.76", "8.67"), "-1.19299");
}

function testSubtraction() {
  test.eq(finmath.subtract("4.95", 5), "-0.05");
}

function testComparison() {
  test.eq(finmath.cmp("0.50", "1.50"), -1);
  test.eq(finmath.cmp("1.50", "1.50"), 0);
  test.eq(finmath.cmp("2.50", "1.50"), 1);
  test.eq(finmath.cmp("0.50", "0.0"), 1);
  test.eq(finmath.cmp("-0.50", "0.00"), -1);
  test.eq(finmath.cmp("0.0", "0.50"), -1);
  test.eq(finmath.cmp("-0", "0"), 0);

  test.eq(finmath.test("1", "<", "0"), false);
  test.eq(finmath.test("1", "<", "1"), false);
  test.eq(finmath.test("1", "<", "2"), true);

  test.eq(finmath.test("1", "<=", "0"), false);
  test.eq(finmath.test("1", "<=", "1"), true);
  test.eq(finmath.test("1", "<=", "2"), true);

  test.eq(finmath.test("1", "==", "0"), false);
  test.eq(finmath.test("1", "==", "1"), true);
  test.eq(finmath.test("1", "==", "2"), false);

  test.eq(finmath.test("1", "!=", "0"), true);
  test.eq(finmath.test("1", "!=", "1"), false);
  test.eq(finmath.test("1", "!=", "2"), true);

  test.eq(finmath.test("1", ">", "0"), true);
  test.eq(finmath.test("1", ">", "1"), false);
  test.eq(finmath.test("1", ">", "2"), false);

  test.eq(finmath.test("1", ">=", "0"), true);
  test.eq(finmath.test("1", ">=", "1"), true);
  test.eq(finmath.test("1", ">=", "2"), false);
}

function testRounding() {
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
}

function testMinMax() {
  test.eq(finmath.max(3), "3");
  test.eq(finmath.max(3, 2), "3");
  test.eq(finmath.max(3, 2, 4), "4");
  test.eq(finmath.max(3, 2, 4, "1.5"), "4");
  test.eq(finmath.max(3, 2, 4, "1.5", "4.5"), "4.5");

  test.eq(finmath.min(3), "3");
  test.eq(finmath.min(3, 2), "2");
  test.eq(finmath.min(3, 2, 4), "2");
  test.eq(finmath.min(3, 2, 4, "1.5"), "1.5");
  test.eq(finmath.min(3, 2, 4, "1.5", "4.5"), "1.5");
}

function testDivision() {
  test.eq(finmath.divide(1, 3), "0.33333");
  test.eq(finmath.divide(-1, 3), "-0.33333");
  test.eq(finmath.divide(2, 3), "0.66667");
  test.eq(finmath.divide(-2, 3), "-0.66667");
  test.eq(finmath.divide("0.00150", 100), "0.00002");
  test.eq(finmath.divide("0.00149", 100), "0.00001");
  test.eq(finmath.divide(100, 20), "5");
  test.eq(finmath.divide(-5, 1000000), "-0.00001");
  test.eq(finmath.divide("5", "2.5"), "2");
  test.eq(finmath.divide("5", "0.5"), "10");
  test.eq(finmath.divide("1.19299", "0.0867"), "13.75998");
}

test.runTests([
  testPresentation,
  testAddition,
  testMultiplicationAndPercentages,
  testSubtraction,
  testComparison,
  testRounding,
  testMinMax,
  testDivision
]);
