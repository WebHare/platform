/* HS Compatibility APIs mimick original HareScript APIs as much as possible. New code should probably not use it (or if they
   find it useful, consider contributing that API to the stdlib.

   Other @webhare/ libs should avoid depending on HSCompat
*/

import * as test from "@webhare/test";
import { Money } from "@webhare/std";
import { isLike, isNotLike, recordLowerBound, recordUpperBound, encodeHSON, decodeHSON, makeDateFromParts, defaultDateTime, maxDateTime } from "@webhare/hscompat";
import { compare } from "@webhare/hscompat/algorithms";
import { localizeDate } from "@webhare/hscompat/datetime";
import { getTypedArray, IPCMarshallableData, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { WebHareBlob } from "@webhare/services";

function testStrings() {
  //based on test_operators.whscr LikeTest
  test.eq(true, isLike("testje", "test*"));
  test.eq(true, isLike("testje", "test??"));
  test.eq(false, isLike("testje", "tess*"));
  test.eq(true, isLike("testje", "*je"));
  test.eq(true, isLike("testje", "****"));
  test.eq(true, isLike("testje", "t?stj?"));
  test.eq(true, isLike("a", "?*"));
  test.eq(false, isLike("", "?*"));

  test.eq(false, isNotLike("testje", "test*"));
  test.eq(false, isNotLike("testje", "test??"));
  test.eq(true, isNotLike("testje", "tess*"));
  test.eq(false, isNotLike("testje", "*je"));
  test.eq(false, isNotLike("testje", "****"));
  test.eq(false, isNotLike("testje", "t?stj?"));
  test.eq(false, isNotLike("a", "?*"));
  test.eq(true, isNotLike("", "?*"));
}

async function testCompare() {
  test.eq(-1, compare(-1, 0));
  test.eq(-1, compare(-1, BigInt(0)));
  test.eq(-1, compare(-1, new Money("0")));
  test.eq(-1, compare(BigInt(-1), 0));
  test.eq(-1, compare(BigInt(-1), BigInt(0)));
  test.eq(-1, compare(BigInt(-1), new Money("0")));
  test.eq(-1, compare(new Money("-1"), 0));
  test.eq(-1, compare(new Money("-1"), BigInt("0")));
  test.eq(-1, compare(new Money("-1"), new Money("0")));
  test.eq(-1, compare(null, -1));
  test.eq(-1, compare(null, 0));
  test.eq(-1, compare(null, 1));
  test.eq(-1, compare(null, BigInt(-1)));
  test.eq(-1, compare(null, BigInt(0)));
  test.eq(-1, compare(null, BigInt(1)));
  test.eq(-1, compare(null, new Money("-1")));
  test.eq(-1, compare(null, new Money("0")));
  test.eq(-1, compare(null, new Money("1")));
  test.eq(-1, compare(null, new Date(-1)));
  test.eq(-1, compare(null, new Date(0)));
  test.eq(-1, compare(null, new Date(1)));
  test.eq(-1, compare("a", "b"));
  test.eq(-1, compare(new Date(1), new Date(2)));

  test.eq(0, compare(0, 0));
  test.eq(0, compare(0, BigInt(0)));
  test.eq(0, compare(0, new Money("0")));
  test.eq(0, compare(BigInt(0), 0));
  test.eq(0, compare(BigInt(0), BigInt(0)));
  test.eq(0, compare(BigInt(0), new Money("0")));
  test.eq(0, compare(new Money("0"), 0));
  test.eq(0, compare(new Money("0"), BigInt("0")));
  test.eq(0, compare(new Money("0"), new Money("0")));
  test.eq(0, compare(null, null));
  test.eq(0, compare("a", "a"));
  test.eq(0, compare(new Date(1), new Date(1)));

  test.eq(1, compare(0, -1));
  test.eq(1, compare(-1, null));
  test.eq(1, compare(0, null));
  test.eq(1, compare(1, null));
  test.eq(1, compare(0, BigInt(-1)));
  test.eq(1, compare(0, new Money("-1")));
  test.eq(1, compare(BigInt(0), -1));
  test.eq(1, compare(BigInt(-1), null));
  test.eq(1, compare(BigInt(0), null));
  test.eq(1, compare(BigInt(1), null));
  test.eq(1, compare(BigInt(0), BigInt(-1)));
  test.eq(1, compare(BigInt("0"), new Money("-1")));
  test.eq(1, compare(new Money("0"), -1));
  test.eq(1, compare(new Money("-1"), null));
  test.eq(1, compare(new Money("0"), null));
  test.eq(1, compare(new Money("1"), null));
  test.eq(1, compare(new Money("0"), BigInt(-1)));
  test.eq(1, compare(new Money("0"), new Money("-1")));
  test.eq(1, compare("b", "a"));
  test.eq(1, compare(new Date(2), new Date(1)));
  test.eq(1, compare(new Date(-1), null));
  test.eq(1, compare(new Date(0), null));
  test.eq(1, compare(new Date(1), null));
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

  test.eq({ found: true, position: 1 }, recordLowerBound(list, { a: 3, b: 1 }, ["a", "b"]));
  test.eq({ found: false, position: 5 }, recordLowerBound(list, { a: 5, b: 8 }, ["a", "b"]));
  test.eq({ found: false, position: 0 }, recordLowerBound(list, { a: 1, b: 8 }, ["a", "b"]));
  test.throws(/.*not.*sorted.*/, () => recordLowerBound([{ a: 3 }, { a: 2 }, { a: 2 }], { a: 2 }, ["a"]));

  test.throws(/Missing key "A" in array\[2\]/, () => recordLowerBound(
    list,
    { a: 1 },
    // @ts-expect-error -- Used key that doesn't exist in list. Error should be given on key list, not on search record!
    ["A"]));

  test.throws(/Missing key "a" in search record/, () => recordLowerBound(
    list,
    // @ts-expect-error -- Used property in searchrecord that doesn't exist in keylist
    { c: 3 },
    ["a"]));

  // should not work with string[] as keys
  const keys = ["a"];
  // @ts-expect-error -- Used keylist that allows other keys than exist in list
  test.eq({ found: true, position: 1 }, recordLowerBound(list, { a: 3 }, keys));

  // should work with type-erased list
  test.eq({ found: true, position: 1 }, recordLowerBound(list as any, { a: 3 }, ["a"]));

  test.throws(/Missing key "b" in search record/, () => recordLowerBound(
    list as any,
    { a: 3 },
    // @ts-expect-error -- but not when searchrecord is known and key doesn't exist there.
    ["b"]));

  // should work with type-erased list of keys
  test.eq({ found: true, position: 1 }, recordLowerBound(list, { a: 3 }, ["a"] as any));

  // should work with type-erased searchrecord
  test.eq({ found: true, position: 1 }, recordLowerBound(list, { a: 3 } as any, ["a"]));
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

  test.eq(1, recordUpperBound(list, { a: 1, b: 10 }, ["a", "b"]));
  test.eq(3, recordUpperBound(list, { a: 3, b: 1 }, ["a", "b"]));
  test.eq(5, recordUpperBound(list, { a: 5, b: 8 }, ["a", "b"]));
  test.eq(0, recordUpperBound(list, { a: 1, b: 8 }, ["a", "b"]));
  test.throws(/.*not.*sorted.*/, () => recordUpperBound([{ a: 1 }, { a: 2 }, { a: 2 }, { a: 1 }], { a: 2 }, ["a"]));


  test.throws(/Missing key "A" in array\[2\]/, () => recordLowerBound(
    list,
    { a: 1 },
    // @ts-expect-error -- Used key that doesn't exist in list. Error should be given on key list, not on search record
    ["A"]));

  test.throws(/Missing key "a" in search record/, () => recordLowerBound(
    list,
    // @ts-expect-error -- Used property in searchrecord that doesn't exist in keylist
    { c: 3 },
    ["a"]));

  // should not work with string[] as keys
  const keys = ["a"];
  // @ts-expect-error -- Used keylist that allows other keys than exist in list
  test.eq(4, recordUpperBound(list, { a: 3 }, keys));

  // should work with type-erased list
  test.eq(4, recordUpperBound(list as any, { a: 3 }, ["a"]));

  test.throws(/Missing key "b" in search record/, () => recordUpperBound(
    list as any,
    { a: 3 },
    // @ts-expect-error -- but not when searchrecord is known and key doesn't exist there
    ["b"]));

  // should work with type-erased list of keys
  test.eq(4, recordUpperBound(list, { a: 3 }, ["a"] as any));

  // should work with type-erased searchrecord
  test.eq(4, recordUpperBound(list, { a: 3 } as any, ["a"]));
}

function testHSONEnDeCode(encoded: string, toencode: IPCMarshallableData) {
  const encval = encodeHSON(toencode);
  test.eq(encoded, encval);
  const decoded = decodeHSON(encval);
  test.eq(toencode, decoded);
}

async function testHSON() {
  testHSONEnDeCode('hson:-2147483648', -2147483648);

  testHSONEnDeCode('hson:5', 5);

  testHSONEnDeCode('hson:-5', -5);

  testHSONEnDeCode('hson:2147483647', 2147483647);

  testHSONEnDeCode('hson:i64 -9223372036854775808', BigInt("-9223372036854775808"));

  testHSONEnDeCode('hson:i64 -5', BigInt(-5));

  testHSONEnDeCode('hson:i64 5', BigInt(5));

  testHSONEnDeCode('hson:i64 9223372036854775807', BigInt("9223372036854775807"));

  //should lowercase keys as HS is case insensitive
  test.eq('hson:{"mixedcase":{"mc":43}}', encodeHSON({ MixedCase: { MC: 43 } }));

  testHSONEnDeCode('hson:"Ab\\"cd\'efgh"', "Ab\"cd'efgh");

  //TODO should this be possible? as \x80 is not valid UTF8  .. testHSONEnDeCode('hson:"Ab\\x80a\\x80\\u00A0"', "Ab\x80a\x80\u00A0");

  testHSONEnDeCode('hson:d"20100101"', new Date(Date.UTC(2010, 0, 1)));

  testHSONEnDeCode('hson:d"20100101T151617"', new Date(Date.UTC(2010, 0, 1, 15, 16, 17)));

  testHSONEnDeCode('hson:d"20100101T151617.123"', new Date(Date.UTC(2010, 0, 1, 15, 16, 17, 123)));
  testHSONEnDeCode('hson:d"20230203T132922"', makeDateFromParts(738554, (13 * 3600 + 29 * 60 + 22) * 1000));

  testHSONEnDeCode('hson:d"201100415"', makeDateFromParts(7344766, 0));

  //  testHSONEnDeCode('hson:b"' + btoa("Ik ben een blob") + '"', Buffer.from("Ik ben een blob"));
  const encval_blob = encodeHSON(WebHareBlob.from("Ik ben een blob"));
  test.eq('hson:b"' + btoa("Ik ben een blob") + '"', encval_blob);
  const decoded_blob = decodeHSON(encval_blob);
  test.assert(decoded_blob instanceof WebHareBlob);
  test.eq("Ik ben een blob", await decoded_blob.text());

  testHSONEnDeCode('hson:m -92233720.75808', new Money("-92233720.75808"));

  testHSONEnDeCode('hson:m -5', new Money("-5"));

  testHSONEnDeCode('hson:m -5.42', new Money("-5.42"));

  testHSONEnDeCode('hson:m 5', new Money("5"));

  testHSONEnDeCode('hson:m 5.42', new Money("5.42"));

  testHSONEnDeCode('hson:m 92233720.75807', new Money("92233720.75807"));

  // TODO is there a need to be able to EncodeAsFloat ? testHSONEnDeCode('hson:f -5', -5);

  // TODO is there a need to be able to EncodeAsFloat ? testHSONEnDeCode('hson:f -5.5', -5.5);

  // TODO is there a need to be able to EncodeAsFloat ? testHSONEnDeCode('hson:f 5', 5);

  // TODO is there a need to be able to EncodeAsFloat ? testHSONEnDeCode('hson:f 5.5', 5.5);

  testHSONEnDeCode('hson:*', null);

  testHSONEnDeCode('hson:{}', {});

  testHSONEnDeCode('hson:va[]', []);

  testHSONEnDeCode('hson:ia[]', getTypedArray(VariableType.IntegerArray, []));

  testHSONEnDeCode('hson:i64a[]', getTypedArray(VariableType.Integer64Array, []));

  testHSONEnDeCode('hson:ma[]', getTypedArray(VariableType.MoneyArray, []));

  testHSONEnDeCode('hson:fa[]', getTypedArray(VariableType.FloatArray, []));

  testHSONEnDeCode('hson:xa[]', getTypedArray(VariableType.BlobArray, []));

  testHSONEnDeCode('hson:ra[]', getTypedArray(VariableType.RecordArray, []));

  testHSONEnDeCode('hson:da[]', getTypedArray(VariableType.DateTimeArray, []));

  testHSONEnDeCode('hson:ba[]', getTypedArray(VariableType.BooleanArray, []));

  testHSONEnDeCode('hson:sa[]', getTypedArray(VariableType.StringArray, []));

  testHSONEnDeCode('hson:ia[1,2,3]', [1, 2, 3]);

  test.eq('hson:b""', encodeHSON(WebHareBlob.from('')));

  testHSONEnDeCode('hson:d""', defaultDateTime);

  testHSONEnDeCode('hson:d"T12345"', makeDateFromParts(0, 12345));

  testHSONEnDeCode('hson:d"MAX"', maxDateTime);

  testHSONEnDeCode('hson:d"00010101T000000.001"', makeDateFromParts(1, 1));

  //FIXME do we *need* to be able to roundtrip MAX-1 to HS ?testHSONEnDeCode('hson:d"58796110711T235959.998"', new Date(864000 * 1000 * 10000000 - 1));

  //FIXME testHSONEnDeCode('hson:"\\x00"', Buffer.from([0]));

  testHSONEnDeCode('hson:{"a":0,"b":1,"c":2}', { c: 2, b: 1, a: 0 }); // test ordering

  //TODO should we be able to encode as float ? testHSONEnDeCode('hson:fa[f 0,f 1]', [ 0, 1 ]);
  testHSONEnDeCode('hson:ia[0,1]', [0, 1]);

  //TODO should we be able to encode as float ? testHSONEnDeCode('hson:va[f 0,f 1,""]', [ 0, 1, "" ]);
  testHSONEnDeCode('hson:va[0,1,""]', [0, 1, ""]);

  //TODO should we be able to explicitly encode as variant array ? testHSONEnDeCode('hson:va[1,2,3]', [ 1,2,3 ]);
  testHSONEnDeCode('hson:ia[1,2,3]', [1, 2, 3]);
  testHSONEnDeCode('hson:i64a[i64 13,i64 11111111111111]', [13n, 11111111111111n]);
  testHSONEnDeCode('hson:fa[f 1e308,f 1e-308,f -1e308,f -1e-308,f 0.0001]', [1e308, 1e-308, -1e308, -1e-308, 0.0001]);

  // Large blob, len not dividable by 3
  let teststr = "1234567";
  for (let i = 0; i < 8; ++i)
    teststr = teststr + teststr + teststr + teststr + teststr;

  //FIXME extremely slow!   testHSONEnDeCode('hson:b"' + btoa(teststr) + '"', Buffer.from(teststr));

  //Explicit invalid syntax
  test.throws(/At.*: Expected HSON type before '\[' token/, () => decodeHSON("hson:[]"));
}

async function testLocalizeDate() {

  let format = "";
  const value = new Date("2010-10-02T13:24:35Z");

  // By default, show year, month and day numerical
  format = "dMy";
  test.eq("10/2/2010", localizeDate(format, value, "en"));
  test.eq("02/10/2010", localizeDate(format, value, "en-GB"));
  test.eq("2-10-2010", localizeDate(format, value, "nl"));
  test.eq("2.10.2010", localizeDate(format, value, "de"));

  // Show long formats were possible
  format = "EEEEGyMMMMdHms"; // H: 24-hour notation
  //Some ICUs report `Saturday, 2 October 2010 AD, 13:24:35`, but somewhere at or before 72.1/2022e it switched to 'Saturday, 2 October 2010 AD at 13:24:35'
  test.eq(/Saturday, October 2, 2010 AD.* 13:24:35/, localizeDate(format, value, "en"));
  test.eq(/Saturday, 2 October 2010 AD.* 13:24:35/, localizeDate(format, value, "en-GB"));
  test.eq(/zaterdag 2 oktober 2010 n.Chr..* 13:24:35/, localizeDate(format, value, "nl"));
  test.eq(/Samstag, 2. Oktober 2010 n. Chr..* 13:24:35/, localizeDate(format, value, "de"));
  format = "EEEEGyMMMMdhms"; // h: 12-hour notation (am/pm marker is added)
  //Some ICUs do `1:24:35 PM`, but somewhere at or before 72.1/2022e it switched to '1:24:35\u202FPM' - 202F is a Narrow NBSP. Today you learned.
  test.eq(/Saturday, October 2, 2010 AD.* 1:24:35.*PM/, localizeDate(format, value, "en"));
  test.eq(/Saturday, 2 October 2010 AD.* 1:24:35.*pm/, localizeDate(format, value, "en-GB"));
  test.eq(/zaterdag 2 oktober 2010 n.Chr..*1:24:35.*p.m./, localizeDate(format, value, "nl"));
  // The German am/pm identifier has changed several times between "vorm."/"nachm." and "AM"/"PM". It's "vorm."/"nachm." in
  // ICU4C 60.2 (CLDR 32.0.1), which we're using for building WebHare, but changed back to "AM"/"PM" in ICU4C 62.1 (CLDR 33.1),
  // which is the current version on development systems. We'll do a like test for now.
  //TestEq("Samstag, 2. Oktober 2010 n. Chr., 1:24:35 PM", localizeDate(format, value, "de"));
  test.eq(/Samstag, 2. Oktober 2010 n. Chr..*1:24:35.*/, localizeDate(format, value, "de"));
  format = "EEEEGyMMMMdjms"; // j: locale-specific notation
  test.eq(/Saturday, October 2, 2010 AD.* 1:24:35.*PM/, localizeDate(format, value, "en"));
  test.eq(/Saturday, 2 October 2010 AD.* 13:24:35/, localizeDate(format, value, "en-GB"));
  test.eq(/zaterdag 2 oktober 2010 n.Chr..* 13:24:35/, localizeDate(format, value, "nl"));
  test.eq(/Samstag, 2. Oktober 2010 n. Chr..* 13:24:35/, localizeDate(format, value, "de"));

  // Show 2-digit values
  format = "yyMMddHHmmss";
  test.eq("10/02/10, 13:24:35", localizeDate(format, value, "en"));
  test.eq("02/10/10, 13:24:35", localizeDate(format, value, "en-GB"));
  test.eq("02-10-10 13:24:35", localizeDate(format, value, "nl"));
  test.eq("02.10.10, 13:24:35", localizeDate(format, value, "de"));

  // Use and show specific timezone
  format = "yMMddjjmmssz";
  test.eq(/10\/02\/2010, 03:24:35.*PM GMT\+2/, localizeDate(format, value, "en", "Europe/Amsterdam")); // Specifying 'z' also results in 'a' being added
  test.eq("02/10/2010, 15:24:35 CEST", localizeDate(format, value, "en-GB", "Europe/Amsterdam"));
  test.eq("02-10-2010 15:24:35 CEST", localizeDate(format, value, "nl", "Europe/Amsterdam"));
  test.eq("02.10.2010, 15:24:35 MESZ", localizeDate(format, value, "de", "Europe/Amsterdam"));

  // Text other than symbols is ignored, format string is interpreted by locale
  format = "d EEEE 'at' j:mm";
  test.eq("2 Saturday, 1:24 PM", localizeDate(format, value, "en"));
  test.eq("Saturday 2, 13:24", localizeDate(format, value, "en-GB"));
  test.eq("zaterdag 2 13:24", localizeDate(format, value, "nl"));
  test.eq("Samstag, 2., 13:24", localizeDate(format, value, "de"));
}

test.run([
  testStrings,
  testCompare,
  testRecordLowerBound,
  testRecordUpperBound,
  testHSON,
  testLocalizeDate
]);
