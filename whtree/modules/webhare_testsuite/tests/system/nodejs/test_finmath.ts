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
  test.eq("0", finmath.formatPrice(0, ".", 0));
  test.eq("0", finmath.formatPrice("0", ".", 0));
  test.eq("0", finmath.formatPrice("-0", ".", 0));
  test.eq("-2", finmath.formatPrice(-2, ".", 0));
  test.eq("-2.0", finmath.formatPrice(-2, ".", 1));
  test.eq("-2.1", finmath.formatPrice("-2.1", ".", 1));
  test.eq("-0.1", finmath.formatPrice("-0.1", ".", 1));
  test.eq("-0.01", finmath.formatPrice("-0.01", ".", 1));
  test.eq("1", finmath.formatPrice("1.0", ".", 0));
  test.eq("1.0", finmath.formatPrice("1.0", ".", 1));
  test.eq("1.01", finmath.formatPrice("1.01", ".", 0));
  test.eq("0.50", finmath.formatPrice("0.50", ".", 2));
  test.eq("119.50", finmath.formatPrice("119.5", ".", 2));
}

function testAddition() {
  test.eq("0.5", finmath.add("0.50", 0));
  test.eq("119.5", finmath.add("119.00", "0.50"));
}

function testMultiplicationAndPercentages() {
  test.eq("415.5", finmath.multiply("138.5", 3));
  test.eq("-138.5", finmath.multiply("138.5", -1));
  test.eq("5", finmath.multiply("-5", -1));
  test.eq("0.145", finmath.multiply("145", "0.001"));
  test.eq("-0.145", finmath.multiply("-145", "0.001"));
  test.eq("0.0145", finmath.multiply("14.5", "0.001"));
  test.eq("-0.0145", finmath.multiply("-14.5", "0.001"));
  test.eq("0.00145", finmath.multiply("1.45", "0.001"));
  test.eq("-0.00145", finmath.multiply("-1.45", "0.001"));
  test.eq("0.00014", finmath.multiply("0.144", "0.001"));
  test.eq("-0.00014", finmath.multiply("-0.144", "0.001"));
  test.eq("0.00015", finmath.multiply("0.145", "0.001"));
  test.eq("-0.00015", finmath.multiply("-0.145", "0.001"));
  test.eq("0.00001", finmath.multiply("0.0145", "0.001"));
  test.eq("-0.00001", finmath.multiply("-0.0145", "0.001"));
  test.eq("1.19299", finmath.multiply("13.76", "0.0867")); //must stay in safe range, so round 1.192992 to 1.19299
  test.eq("-1.19299", finmath.multiply("-13.76", "0.0867"));
  test.eq("415.5", finmath.getPercentageOfAmount("138.5", 300));
  test.eq("-138.5", finmath.getPercentageOfAmount("138.5", -100));
  test.eq("5", finmath.getPercentageOfAmount("-5", -100));
  test.eq("0.145", finmath.getPercentageOfAmount("145", "0.1"));
  test.eq("-0.145", finmath.getPercentageOfAmount("-145", "0.1"));
  test.eq("0.0145", finmath.getPercentageOfAmount("14.5", "0.1"));
  test.eq("-0.0145", finmath.getPercentageOfAmount("-14.5", "0.1"));
  test.eq("0.00145", finmath.getPercentageOfAmount("1.45", "0.1"));
  test.eq("-0.00145", finmath.getPercentageOfAmount("-1.45", "0.1"));
  test.eq("0.00014", finmath.getPercentageOfAmount("0.144", "0.1"));
  test.eq("-0.00014", finmath.getPercentageOfAmount("-0.144", "0.1"));
  test.eq("0.00015", finmath.getPercentageOfAmount("0.145", "0.1"));
  test.eq("-0.00015", finmath.getPercentageOfAmount("-0.145", "0.1"));
  test.eq("0.00001", finmath.getPercentageOfAmount("0.0145", "0.1"));
  test.eq("-0.00001", finmath.getPercentageOfAmount("-0.0145", "0.1"));
  test.eq("1.19299", finmath.getPercentageOfAmount("13.76", "8.67")); //must stay in safe range, so round 1.192992 to 1.19299
  test.eq("-1.19299", finmath.getPercentageOfAmount("-13.76", "8.67"));
}

function testSubtraction() {
  test.eq("-0.05", finmath.subtract("4.95", 5));
}

function testComparison() {
  test.eq(-1, finmath.cmp("0.50", "1.50"));
  test.eq(0, finmath.cmp("1.50", "1.50"));
  test.eq(1, finmath.cmp("2.50", "1.50"));
  test.eq(1, finmath.cmp("0.50", "0.0"));
  test.eq(-1, finmath.cmp("-0.50", "0.00"));
  test.eq(-1, finmath.cmp("0.0", "0.50"));
  test.eq(0, finmath.cmp("-0", "0"));

  test.eq(false, finmath.test("1", "<", "0"));
  test.eq(false, finmath.test("1", "<", "1"));
  test.eq(true, finmath.test("1", "<", "2"));

  test.eq(false, finmath.test("1", "<=", "0"));
  test.eq(true, finmath.test("1", "<=", "1"));
  test.eq(true, finmath.test("1", "<=", "2"));

  test.eq(false, finmath.test("1", "==", "0"));
  test.eq(true, finmath.test("1", "==", "1"));
  test.eq(false, finmath.test("1", "==", "2"));

  test.eq(true, finmath.test("1", "!=", "0"));
  test.eq(false, finmath.test("1", "!=", "1"));
  test.eq(true, finmath.test("1", "!=", "2"));

  test.eq(true, finmath.test("1", ">", "0"));
  test.eq(false, finmath.test("1", ">", "1"));
  test.eq(false, finmath.test("1", ">", "2"));

  test.eq(true, finmath.test("1", ">=", "0"));
  test.eq(true, finmath.test("1", ">=", "1"));
  test.eq(false, finmath.test("1", ">=", "2"));
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
  test.eq("3", finmath.max(3));
  test.eq("3", finmath.max(3, 2));
  test.eq("4", finmath.max(3, 2, 4));
  test.eq("4", finmath.max(3, 2, 4, "1.5"));
  test.eq("4.5", finmath.max(3, 2, 4, "1.5", "4.5"));

  test.eq("3", finmath.min(3));
  test.eq("2", finmath.min(3, 2));
  test.eq("2", finmath.min(3, 2, 4));
  test.eq("1.5", finmath.min(3, 2, 4, "1.5"));
  test.eq("1.5", finmath.min(3, 2, 4, "1.5", "4.5"));
}

function testDivision() {
  test.eq("0.33333", finmath.divide(1, 3));
  test.eq("-0.33333", finmath.divide(-1, 3));
  test.eq("0.66667", finmath.divide(2, 3));
  test.eq("-0.66667", finmath.divide(-2, 3));
  test.eq("0.00002", finmath.divide("0.00150", 100));
  test.eq("0.00001", finmath.divide("0.00149", 100));
  test.eq("5", finmath.divide(100, 20));
  test.eq("-0.00001", finmath.divide(-5, 1000000));
  test.eq("2", finmath.divide("5", "2.5"));
  test.eq("10", finmath.divide("5", "0.5"));
  test.eq("13.75998", finmath.divide("1.19299", "0.0867"));
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
