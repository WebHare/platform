/* globals describe it */
import * as finmath from "@mod-system/js/util/finmath.es";
import assert from "assert";

// Uncomment to show getTid debugging information
//domdebug.debugflags.gtd = true;

// Test language

describe("Finmath test", function()
{
  it("presentation", async function()
  {
    assert.strictEqual(finmath.formatPrice(0, ".", 0),"0");
    assert.strictEqual(finmath.formatPrice("0", ".", 0),"0");
    assert.strictEqual(finmath.formatPrice("-0", ".", 0),"0");
    assert.strictEqual(finmath.formatPrice(-2, ".", 0),"-2");
    assert.strictEqual(finmath.formatPrice(-2, ".", 1),"-2.0");
    assert.strictEqual(finmath.formatPrice("-2.1", ".", 1),"-2.1");
    assert.strictEqual(finmath.formatPrice("-0.1", ".", 1),"-0.1");
    assert.strictEqual(finmath.formatPrice("-0.01", ".", 1),"-0.01");
    assert.strictEqual(finmath.formatPrice("1.0", ".", 0),"1");
    assert.strictEqual(finmath.formatPrice("1.0", ".", 1),"1.0");
    assert.strictEqual(finmath.formatPrice("1.01", ".", 0),"1.01");
    assert.strictEqual(finmath.formatPrice("0.50", ".", 2),"0.50");
    assert.strictEqual(finmath.formatPrice("119.5", ".", 2),"119.50");
  });
  it("addition", async function()
  {
    assert.strictEqual(finmath.add("0.50",0),"0.5");
    assert.strictEqual(finmath.add("119.00","0.50"),"119.5");
  });
  it("multiplication and percentages", async function()
  {
    assert.strictEqual(finmath.multiply("138.5",3),"415.5");
    assert.strictEqual(finmath.multiply("138.5",-1),"-138.5");
    assert.strictEqual(finmath.multiply("-5",-1),"5");
    assert.strictEqual(finmath.multiply("145","0.001"),"0.145");
    assert.strictEqual(finmath.multiply("-145","0.001"),"-0.145");
    assert.strictEqual(finmath.multiply("14.5","0.001"),"0.0145");
    assert.strictEqual(finmath.multiply("-14.5","0.001"),"-0.0145");
    assert.strictEqual(finmath.multiply("1.45","0.001"),"0.00145");
    assert.strictEqual(finmath.multiply("-1.45","0.001"),"-0.00145");
    assert.strictEqual(finmath.multiply("0.144","0.001"),"0.00014");
    assert.strictEqual(finmath.multiply("-0.144","0.001"),"-0.00014");
    assert.strictEqual(finmath.multiply("0.145","0.001"),"0.00015");
    assert.strictEqual(finmath.multiply("-0.145","0.001"),"-0.00015");
    assert.strictEqual(finmath.multiply("0.0145","0.001"),"0.00001");
    assert.strictEqual(finmath.multiply("-0.0145","0.001"),"-0.00001");
    assert.strictEqual(finmath.multiply("13.76","0.0867"),"1.19299"); //must stay in safe range, so round 1.192992 to 1.19299
    assert.strictEqual(finmath.multiply("-13.76","0.0867"),"-1.19299");
    assert.strictEqual(finmath.getPercentageOfAmount("138.5",300),"415.5");
    assert.strictEqual(finmath.getPercentageOfAmount("138.5",-100),"-138.5");
    assert.strictEqual(finmath.getPercentageOfAmount("-5",-100),"5");
    assert.strictEqual(finmath.getPercentageOfAmount("145","0.1"),"0.145");
    assert.strictEqual(finmath.getPercentageOfAmount("-145","0.1"),"-0.145");
    assert.strictEqual(finmath.getPercentageOfAmount("14.5","0.1"),"0.0145");
    assert.strictEqual(finmath.getPercentageOfAmount("-14.5","0.1"),"-0.0145");
    assert.strictEqual(finmath.getPercentageOfAmount("1.45","0.1"),"0.00145");
    assert.strictEqual(finmath.getPercentageOfAmount("-1.45","0.1"),"-0.00145");
    assert.strictEqual(finmath.getPercentageOfAmount("0.144","0.1"),"0.00014");
    assert.strictEqual(finmath.getPercentageOfAmount("-0.144","0.1"),"-0.00014");
    assert.strictEqual(finmath.getPercentageOfAmount("0.145","0.1"),"0.00015");
    assert.strictEqual(finmath.getPercentageOfAmount("-0.145","0.1"),"-0.00015");
    assert.strictEqual(finmath.getPercentageOfAmount("0.0145","0.1"),"0.00001");
    assert.strictEqual(finmath.getPercentageOfAmount("-0.0145","0.1"),"-0.00001");
    assert.strictEqual(finmath.getPercentageOfAmount("13.76","8.67"),"1.19299"); //must stay in safe range, so round 1.192992 to 1.19299
    assert.strictEqual(finmath.getPercentageOfAmount("-13.76","8.67"),"-1.19299");
  });
  it("subtraction", async function()
  {
    assert.strictEqual(finmath.subtract("4.95", 5),"-0.05");
  });
  it("comparison", async function()
  {
    assert.strictEqual(finmath.cmp("0.50","1.50"), -1);
    assert.strictEqual(finmath.cmp("1.50","1.50"), 0);
    assert.strictEqual(finmath.cmp("2.50","1.50"), 1);
    assert.strictEqual(finmath.cmp("0.50","0.0"), 1);
    assert.strictEqual(finmath.cmp("-0.50","0.00"), -1);
    assert.strictEqual(finmath.cmp("0.0","0.50"), -1);
    assert.strictEqual(finmath.cmp("-0","0"), 0);

    assert.strictEqual(finmath.test("1","<","0"), false);
    assert.strictEqual(finmath.test("1","<","1"), false);
    assert.strictEqual(finmath.test("1","<","2"), true);

    assert.strictEqual(finmath.test("1","<=","0"), false);
    assert.strictEqual(finmath.test("1","<=","1"), true);
    assert.strictEqual(finmath.test("1","<=","2"), true);

    assert.strictEqual(finmath.test("1","==","0"), false);
    assert.strictEqual(finmath.test("1","==","1"), true);
    assert.strictEqual(finmath.test("1","==","2"), false);

    assert.strictEqual(finmath.test("1","!=","0"), true);
    assert.strictEqual(finmath.test("1","!=","1"), false);
    assert.strictEqual(finmath.test("1","!=","2"), true);

    assert.strictEqual(finmath.test("1",">","0"), true);
    assert.strictEqual(finmath.test("1",">","1"), false);
    assert.strictEqual(finmath.test("1",">","2"), false);

    assert.strictEqual(finmath.test("1",">=","0"), true);
    assert.strictEqual(finmath.test("1",">=","1"), true);
    assert.strictEqual(finmath.test("1",">=","2"), false);
  });

  it("rounding", async function()
  {
    // Keep in sync with test_numbers.whscr

    function testRounding(base, mode, expect)
    {
      let got = [], mgot = [], mexpect = [];

      for (let i = -base; i <= base; ++i)
      {
        mexpect.push(finmath.multiply(expect[i+base], "0.1"));
        got.push(finmath.__roundIntegerToMultiple(i, base, mode));
        mgot.push(finmath.roundToMultiple(finmath.multiply(i, "0.1"), finmath.multiply(base, "0.1"), mode));
      }

      assert.strictEqual(expect.join("_"), got.join("_"), `Rounding mode ${mode} for integer`);
      assert.strictEqual(mexpect.join("_"), mgot.join("_"), `Rounding mode ${mode} for money`);
    }

    //                                        -5  -4  -3  -2  -1  0  1  2  3  4  5
    testRounding(5, "toward-zero",          [ -5,  0,  0,  0,  0, 0, 0, 0, 0, 0, 5 ]);
    testRounding(5, "down",                 [ -5, -5, -5, -5, -5, 0, 0, 0, 0, 0, 5 ]);
    testRounding(5, "up",                   [ -5,  0,  0,  0,  0, 0, 5, 5, 5, 5, 5 ]);
    testRounding(5, "half-toward-zero",     [ -5, -5, -5,  0,  0, 0, 0, 0, 5, 5, 5 ]);
    testRounding(5, "half-down",            [ -5, -5, -5,  0,  0, 0, 0, 0, 5, 5, 5 ]);
    testRounding(5, "half-up",              [ -5, -5, -5,  0,  0, 0, 0, 0, 5, 5, 5 ]);

    //                                        -6  -5  -4  -3  -2  -1  0  1  2  3  4  5  6
    testRounding(6, "toward-zero",          [ -6,  0,  0,  0,  0,  0, 0, 0, 0, 0, 0, 0, 6 ]);
    testRounding(6, "down",                 [ -6, -6, -6, -6, -6, -6, 0, 0, 0, 0, 0, 0, 6 ]);
    testRounding(6, "up",                   [ -6,  0,  0,  0,  0,  0, 0, 6, 6, 6, 6, 6, 6 ]);
    testRounding(6, "half-toward-zero",     [ -6, -6, -6,  0,  0,  0, 0, 0, 0, 0, 6, 6, 6 ]);
    testRounding(6, "half-down",            [ -6, -6, -6, -6,  0,  0, 0, 0, 0, 0, 6, 6, 6 ]);
    testRounding(6, "half-up",              [ -6, -6, -6,  0,  0,  0, 0, 0, 0, 6, 6, 6, 6 ]);
  });

  it("minmax", async function()
  {
    assert.strictEqual(finmath.max(3), "3");
    assert.strictEqual(finmath.max(3, 2), "3");
    assert.strictEqual(finmath.max(3, 2, 4), "4");
    assert.strictEqual(finmath.max(3, 2, 4, "1.5"), "4");
    assert.strictEqual(finmath.max(3, 2, 4, "1.5", "4.5"), "4.5");

    assert.strictEqual(finmath.min(3), "3");
    assert.strictEqual(finmath.min(3, 2), "2");
    assert.strictEqual(finmath.min(3, 2, 4), "2");
    assert.strictEqual(finmath.min(3, 2, 4, "1.5"), "1.5");
    assert.strictEqual(finmath.min(3, 2, 4, "1.5", "4.5"), "1.5");
  });
  it("division", async function()
  {
    assert.strictEqual(finmath.moneyDivide(1, 3), "0.33333");
    assert.strictEqual(finmath.moneyDivide(-1, 3), "-0.33333");
    assert.strictEqual(finmath.moneyDivide(2, 3), "0.66667");
    assert.strictEqual(finmath.moneyDivide(-2, 3), "-0.66667");
    assert.strictEqual(finmath.moneyDivide("0.00150", 100), "0.00002");
    assert.strictEqual(finmath.moneyDivide("0.00149", 100), "0.00001");
    assert.strictEqual(finmath.moneyDivide(100, 20), "5");
    assert.strictEqual(finmath.moneyDivide(-5, 1000000), "-0.00001");
    assert.strictEqual(finmath.moneyDivide("5", "2.5"), "2");
    assert.strictEqual(finmath.moneyDivide("5", "0.5"), "10");
    assert.strictEqual(finmath.moneyDivide("1.19299", "0.0867"), "13.75998");
  });
});

