/* HS Compatibility APIs mimick original HareScript APIs as much as possible. New code should probably not use it (or if they
   find it useful, consider contributing that API to the stdlib.

   Other @webhare/ libs should avoid depending on HSCompat
*/

import * as test from "@webhare/test";
import * as strings from "@webhare/hscompat/strings";
import * as algorithms from "@webhare/hscompat/algorithms";
import { Money } from "@mod-system/js/internal/whmanager/hsmarshalling";

function testStrings() {
  //based on test_operators.whscr LikeTest
  test.eq(true, strings.isLike("testje", "test*"));
  test.eq(true, strings.isLike("testje", "test??"));
  test.eq(false, strings.isLike("testje", "tess*"));
  test.eq(true, strings.isLike("testje", "*je"));
  test.eq(true, strings.isLike("testje", "****"));
  test.eq(true, strings.isLike("testje", "t?stj?"));
  test.eq(true, strings.isLike("a", "?*"));
  test.eq(false, strings.isLike("", "?*"));

  test.eq(false, strings.isNotLike("testje", "test*"));
  test.eq(false, strings.isNotLike("testje", "test??"));
  test.eq(true, strings.isNotLike("testje", "tess*"));
  test.eq(false, strings.isNotLike("testje", "*je"));
  test.eq(false, strings.isNotLike("testje", "****"));
  test.eq(false, strings.isNotLike("testje", "t?stj?"));
  test.eq(false, strings.isNotLike("a", "?*"));
  test.eq(true, strings.isNotLike("", "?*"));
}

async function testCompare() {
  test.eq(-1, algorithms.compare(-1, 0));
  test.eq(-1, algorithms.compare(-1, BigInt(0)));
  test.eq(-1, algorithms.compare(-1, new Money("0")));
  test.eq(-1, algorithms.compare(BigInt(-1), 0));
  test.eq(-1, algorithms.compare(BigInt(-1), BigInt(0)));
  test.eq(-1, algorithms.compare(BigInt(-1), new Money("0")));
  test.eq(-1, algorithms.compare(new Money("-1"), 0));
  test.eq(-1, algorithms.compare(new Money("-1"), BigInt("0")));
  test.eq(-1, algorithms.compare(new Money("-1"), new Money("0")));
  test.eq(-1, algorithms.compare(null, -1));
  test.eq(-1, algorithms.compare(null, 0));
  test.eq(-1, algorithms.compare(null, 1));
  test.eq(-1, algorithms.compare(null, BigInt(-1)));
  test.eq(-1, algorithms.compare(null, BigInt(0)));
  test.eq(-1, algorithms.compare(null, BigInt(1)));
  test.eq(-1, algorithms.compare(null, new Money("-1")));
  test.eq(-1, algorithms.compare(null, new Money("0")));
  test.eq(-1, algorithms.compare(null, new Money("1")));
  test.eq(-1, algorithms.compare("a", "b"));
  test.eq(-1, algorithms.compare(new Date(1), new Date(2)));

  test.eq(0, algorithms.compare(0, 0));
  test.eq(0, algorithms.compare(0, BigInt(0)));
  test.eq(0, algorithms.compare(0, new Money("0")));
  test.eq(0, algorithms.compare(BigInt(0), 0));
  test.eq(0, algorithms.compare(BigInt(0), BigInt(0)));
  test.eq(0, algorithms.compare(BigInt(0), new Money("0")));
  test.eq(0, algorithms.compare(new Money("0"), 0));
  test.eq(0, algorithms.compare(new Money("0"), BigInt("0")));
  test.eq(0, algorithms.compare(new Money("0"), new Money("0")));
  test.eq(0, algorithms.compare(null, null));
  test.eq(0, algorithms.compare("a", "a"));
  test.eq(0, algorithms.compare(new Date(1), new Date(1)));

  test.eq(1, algorithms.compare(0, -1));
  test.eq(1, algorithms.compare(-1, null));
  test.eq(1, algorithms.compare(0, null));
  test.eq(1, algorithms.compare(1, null));
  test.eq(1, algorithms.compare(0, BigInt(-1)));
  test.eq(1, algorithms.compare(0, new Money("-1")));
  test.eq(1, algorithms.compare(BigInt(0), -1));
  test.eq(1, algorithms.compare(BigInt(-1), null));
  test.eq(1, algorithms.compare(BigInt(0), null));
  test.eq(1, algorithms.compare(BigInt(1), null));
  test.eq(1, algorithms.compare(BigInt(0), BigInt(-1)));
  test.eq(1, algorithms.compare(BigInt("0"), new Money("-1")));
  test.eq(1, algorithms.compare(new Money("0"), -1));
  test.eq(1, algorithms.compare(new Money("-1"), null));
  test.eq(1, algorithms.compare(new Money("0"), null));
  test.eq(1, algorithms.compare(new Money("1"), null));
  test.eq(1, algorithms.compare(new Money("0"), BigInt(-1)));
  test.eq(1, algorithms.compare(new Money("0"), new Money("-1")));
  test.eq(1, algorithms.compare("b", "a"));
  test.eq(1, algorithms.compare(new Date(2), new Date(1)));
}

async function testRecordLowerBound() {
  // List (sorted on 'a', then 'b')
  const list = [
    { a: 1, b: 10, text: "value 1" },
    { a: 3, b: 1, text: "second value" },
    { a: 3, b: 1, text: "second value, again" },
    { a: 3, b: 3, text: "value 3" },
    { a: 5, b: 7, text: "last value" }
  ];

  test.eq({ found: true, position: 1 }, algorithms.recordLowerBound(list, { a: 3, b: 1 }, ["a", "b"]));
  test.eq({ found: false, position: 5 }, algorithms.recordLowerBound(list, { a: 5, b: 8 }, ["a", "b"]));
  test.eq({ found: false, position: 0 }, algorithms.recordLowerBound(list, { a: 1, b: 8 }, ["a", "b"]));
  test.throws(/.*not.*sorted.*/, () => algorithms.recordLowerBound([{ a: 3 }, { a: 2 }, { a: 2 }], { a: 2 }, ["a"]));

  await test.throws(/Missing key "A" in array\[2\]/, () => algorithms.recordLowerBound(
    list,
    { a: 1 },
    // @ts-expect-error -- Used key that doesn't exist in list. Error should be given on key list, not on search record!
    ["A"]));

  await test.throws(/Missing key "a" in search record/, () => algorithms.recordLowerBound(
    list,
    // @ts-expect-error -- Used property in searchrecord that doesn't exist in keylist
    { c: 3 },
    ["a"]));

  // should not work with string[] as keys
  const keys = ["a"];
  // @ts-expect-error -- Used keylist that allows other keys than exist in list
  test.eq({ found: true, position: 1 }, algorithms.recordLowerBound(list, { a: 3 }, keys));

  // should work with type-erased list
  test.eq({ found: true, position: 1 }, algorithms.recordLowerBound(list as any, { a: 3 }, ["a"]));

  await test.throws(/Missing key "b" in search record/, () => algorithms.recordLowerBound(
    list as any,
    { a: 3 },
    // @ts-expect-error -- but not when searchrecord is known and key doesn't exist there.
    ["b"]));

  // should work with type-erased list of keys
  test.eq({ found: true, position: 1 }, algorithms.recordLowerBound(list, { a: 3 }, ["a"] as any));

  // should work with type-erased searchrecord
  test.eq({ found: true, position: 1 }, algorithms.recordLowerBound(list, { a: 3 } as any, ["a"]));
}

async function testRecordUpperBound() {
  // List (sorted on 'a', then 'b')
  const list = [
    { a: 1, b: 10, text: "value 1" },
    { a: 3, b: 1, text: "second value" },
    { a: 3, b: 1, text: "second value, again" },
    { a: 3, b: 3, text: "value 3" },
    { a: 5, b: 7, text: "last value" }
  ];

  test.eq(1, algorithms.recordUpperBound(list, { a: 1, b: 10 }, ["a", "b"]));
  test.eq(3, algorithms.recordUpperBound(list, { a: 3, b: 1 }, ["a", "b"]));
  test.eq(5, algorithms.recordUpperBound(list, { a: 5, b: 8 }, ["a", "b"]));
  test.eq(0, algorithms.recordUpperBound(list, { a: 1, b: 8 }, ["a", "b"]));
  await test.throws(/.*not.*sorted.*/, () => algorithms.recordUpperBound([{ a: 1 }, { a: 2 }, { a: 2 }, { a: 1 }], { a: 2 }, ["a"]));


  await test.throws(/Missing key "A" in array\[2\]/, () => algorithms.recordLowerBound(
    list,
    { a: 1 },
    // @ts-expect-error -- Used key that doesn't exist in list. Error should be given on key list, not on search record
    ["A"]));

  await test.throws(/Missing key "a" in search record/, () => algorithms.recordLowerBound(
    list,
    // @ts-expect-error -- Used property in searchrecord that doesn't exist in keylist
    { c: 3 },
    ["a"]));

  // should not work with string[] as keys
  const keys = ["a"];
  // @ts-expect-error -- Used keylist that allows other keys than exist in list
  test.eq(4, algorithms.recordUpperBound(list, { a: 3 }, keys));

  // should work with type-erased list
  test.eq(4, algorithms.recordUpperBound(list as any, { a: 3 }, ["a"]));

  await test.throws(/Missing key "b" in search record/, () => algorithms.recordUpperBound(
    list as any,
    { a: 3 },
    // @ts-expect-error -- but not when searchrecord is known and key doesn't exist there
    ["b"]));

  // should work with type-erased list of keys
  test.eq(4, algorithms.recordUpperBound(list, { a: 3 }, ["a"] as any));

  // should work with type-erased searchrecord
  test.eq(4, algorithms.recordUpperBound(list, { a: 3 } as any, ["a"]));
}

test.run([
  testStrings,
  testCompare,
  testRecordLowerBound,
  testRecordUpperBound
]);
