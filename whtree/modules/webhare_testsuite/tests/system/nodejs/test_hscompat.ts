/* HS Compatibility APIs mimick original HareScript APIs as much as possible. New code should probably not use it (or if they
   find it useful, consider contributing that API to the stdlib.

   Other @webhare/ libs should avoid depending on HSCompat
*/
import * as test from "@webhare/test";
import { isBlob, Money, toCamelCase, toSnakeCase } from "@webhare/std";
import { isLike, isNotLike, recordLowerBound, recordUpperBound, encodeHSON, decodeHSON, makeDateFromParts, defaultDateTime, maxDateTime, omitHareScriptDefaultValues, wrdGuidToUUID, UUIDToWrdGuid, setHareScriptType } from "@webhare/hscompat";
import { lowerBound, recordRange, recordRangeIterator, upperBound } from "@webhare/hscompat/src/algorithms";
import { getRoundedDateTime, localizeDate } from "@webhare/hscompat/src/datetime";
import { getTypedArray, type IPCMarshallableData, VariableType } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { WebHareBlob } from "@webhare/services";

function testStrings() {
  //based on test_operators.whscr LikeTest
  test.eq(true, isLike("testje", "test*"));
  test.eq(true, isLike("testje", "test??"));
  test.eq(false, isLike("testje", "tess*"));
  test.eq(true, isLike("testje", "*je"));
  test.eq(true, isLike("testje", "****"));
  test.eq(true, isLike("testje", "t?stj?"));
  test.eq(false, isLike("testje", "test"));
  test.eq(true, isLike("testje", "testje"));
  test.eq(false, isLike("testje", "est*"));
  test.eq(true, isLike("testje", "*est*"));
  test.eq(true, isLike("a", "?*"));
  test.eq(false, isLike("", "?*"));

  test.eq(false, isNotLike("testje", "test*"));
  test.eq(false, isNotLike("testje", "test??"));
  test.eq(true, isNotLike("testje", "tess*"));
  test.eq(false, isNotLike("testje", "*je"));
  test.eq(false, isNotLike("testje", "****"));
  test.eq(false, isNotLike("testje", "t?stj?"));
  test.eq(true, isNotLike("testje", "test"));
  test.eq(false, isNotLike("testje", "testje"));
  test.eq(true, isNotLike("testje", "est*"));
  test.eq(false, isNotLike("testje", "*est*"));
  test.eq(false, isNotLike("a", "?*"));
  test.eq(true, isNotLike("", "?*"));
}

async function testBlobs() {
  //verify WebHareBlob (and thus HSVMBlob) are properly recognized as a Blob so they can safely be marshalled
  const blobbie: WebHareBlob = WebHareBlob.from("Ik ben een blob");
  test.assert(isBlob(blobbie), "It has to quack like a blob for toCamelCase/toSnakeCase to work");
  test.eq({ camelBlob: (b: Blob) => b === blobbie && "arrayBuffer" in b && !("arraybuffer" in b) && !("array_buffer" in b) }, toCamelCase({ camel_blob: blobbie }));
  test.eq({ camel_blob: (b: Blob) => b === blobbie && "arrayBuffer" in b && !("arraybuffer" in b) && !("array_buffer" in b) }, toSnakeCase({ camelBlob: blobbie }));
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

async function testRecordRange() {
  // List (sorted on 'a', then 'b')
  const list = [
    { a: 1, b: 10, text: "value 1" },
    { a: 3, b: 1, text: "second value" },
    { a: 3, b: 1, text: "second value, again" },
    { a: 3, b: 3, text: "value 3" },
    { a: 5, b: 7, text: "last value" }
  ];

  test.eq(list.slice(0, 1), recordRange(list, { a: 1, b: 10 }, ["a", "b"]));
  test.eq(list.slice(1, 3), recordRange(list, { a: 3, b: 1 }, ["a", "b"]));
  test.eq([], recordRange(list, { a: 5, b: 8 }, ["a", "b"]));
  test.eq([], recordRange(list, { a: 1, b: 8 }, ["a", "b"]));
  test.eq(list.slice(0, 1), recordRange(list, { a: 1 }, ["a"]));

  test.eq(list.slice(0, 1), [...recordRangeIterator(list, { a: 1, b: 10 }, ["a", "b"])]);
  test.eq(list.slice(1, 3), [...recordRangeIterator(list, { a: 3, b: 1 }, ["a", "b"])]);
  test.eq([], [...recordRangeIterator(list, { a: 5, b: 8 }, ["a", "b"])]);
  test.eq([], [...recordRangeIterator(list, { a: 1, b: 8 }, ["a", "b"])]);
  test.eq(list.slice(0, 1), [...recordRangeIterator(list, { a: 1 }, ["a"])]);

  test.throws(/.*not.*sorted.*/, () => recordRange([{ a: 1 }, { a: 2 }, { a: 2 }, { a: 1 }], { a: 2 }, ["a"]));

  test.throws(/Missing key "A" in array\[2\]/, () => recordRange(
    list,
    { a: 1 },
    // @ts-expect-error -- Used key that doesn't exist in list. Error should be given on key list, not on search record
    ["A"]));

  test.throws(/Missing key "a" in search record/, () => recordRange(
    list,
    // @ts-expect-error -- Used property in searchrecord that doesn't exist in keylist
    { c: 3 },
    ["a"]));

  // should not work with string[] as keys
  const keys = ["a"];
  // @ts-expect-error -- Used keylist that allows other keys than exist in list
  test.eq(list.slice(1, 4), recordRange(list, { a: 3 }, keys));

  // should work with type-erased list
  test.eq(list.slice(1, 4) as Array<{ a: 3 }>, recordRange(list as any, { a: 3 }, ["a"]));

  test.throws(/Missing key "b" in search record/, () => recordRange(
    list as any,
    { a: 3 },
    // @ts-expect-error -- but not when searchrecord is known and key doesn't exist there
    ["b"]));

  // should work with type-erased list of keys
  test.eq(list.slice(1, 4), recordRange(list, { a: 3 }, ["a"] as any));

  // should work with type-erased searchrecord
  test.eq(list.slice(1, 4), recordRange(list, { a: 3 } as any, ["a"]));

}

function testLowerBound() {
  test.eq({ found: true, position: 2 }, lowerBound([0, 1, 2, 3, 4], 2));
  test.eq({ found: false, position: 2 }, lowerBound([0, 1, 2, 3, 4], 1.5));
  test.eq({ found: true, position: 0 }, lowerBound([null, 2], null));
  test.eq({ found: false, position: 1 }, lowerBound([null, 2], 1));
  test.eq({ found: true, position: 1 }, lowerBound([null, 2], 2));
}

function testUpperBound() {
  test.eq(3, upperBound([0, 1, 2, 3, 4], 2));
  test.eq(2, upperBound([0, 1, 2, 3, 4], 1.5));
  test.eq(1, upperBound([null, 2], null));
  test.eq(1, upperBound([null, 2], 1));
  test.eq(2, upperBound([null, 2], 2));
}

function testWRDSupport() {
  test.eq("07004000-0000-4000-a000-00bea61ef00d", wrdGuidToUUID("wrd:0700400000004000A00000BEA61EF00D")); //wrd_settings_guid
  test.eq("wrd:0700400000004000A00000BEA61EF00D", UUIDToWrdGuid("07004000-0000-4000-a000-00bea61ef00d"));
}

function testHSONEnDeCode(encoded: string, toencode: IPCMarshallableData) {
  const encval = encodeHSON(toencode);
  test.eq(encoded, encval);
  const decoded = decodeHSON(encval);
  test.eq(toencode, decoded);
}

async function testHSON() {
  test.throws(/Cannot.*NaN/, () => encodeHSON(NaN));
  test.throws(/Cannot.*Infinity/, () => encodeHSON(Infinity));
  test.throws(/Cannot.*-Infinity/, () => encodeHSON(-Infinity));

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
  test.assert(WebHareBlob.isWebHareBlob(decoded_blob));
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

  const emptyArray: unknown[] = [];
  testHSONEnDeCode('hson:va[]', emptyArray as IPCMarshallableData);
  setHareScriptType(emptyArray, VariableType.RecordArray);
  testHSONEnDeCode('hson:ra[]', emptyArray as IPCMarshallableData);
  setHareScriptType(emptyArray, VariableType.RecordArray); //setting it twice regressed once with 'Cannot redefine property: Symbol(Marshaller)'
  testHSONEnDeCode('hson:ra[]', emptyArray as IPCMarshallableData);

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

  //Undefined values
  test.eq("hson:*", encodeHSON(undefined!));
  test.eq("hson:va[0,*,*,3]", encodeHSON([0, undefined!, null, 3]));
  test.eq(`hson:va[0,*,*,3,{"a":4,"c":*}]`, encodeHSON([0, undefined!, null, 3, { a: 4, b: undefined!, c: null }]));
}

async function testRoundedDate() {
  const testdate = new Date("2007-05-02T11:20:17.123Z");
  test.eq(new Date("2007-05-02T11:20:17.000Z"), getRoundedDateTime(testdate, 1000));
  test.eq(new Date("2007-05-02T11:20:16.000Z"), getRoundedDateTime(testdate, 2000));
  test.eq(new Date("2007-05-02T00:00:00.000Z"), getRoundedDateTime(testdate, 86400 * 1000));
  test.eq(new Date("2007-05-02T11:20:00.000Z"), getRoundedDateTime(testdate, "minute"));
  test.eq(new Date("2007-05-02T11:00:00.000Z"), getRoundedDateTime(testdate, "hour"));
  test.eq(new Date("2007-05-02T00:00:00.000Z"), getRoundedDateTime(testdate, "day"));
  test.eq(defaultDateTime, getRoundedDateTime(defaultDateTime, 86400 * 1000));
  test.eq(maxDateTime, getRoundedDateTime(maxDateTime, 86400 * 1000));
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
  //as of 27 march 2024, the ',' doesnt appear
  test.eq(/Saturday,? 2 October 2010 AD.* 13:24:35/, localizeDate(format, value, "en-GB"));
  test.eq(/zaterdag 2 oktober 2010 n.Chr..* 13:24:35/, localizeDate(format, value, "nl"));
  test.eq(/Samstag, 2. Oktober 2010 n. Chr..* 13:24:35/, localizeDate(format, value, "de"));
  format = "EEEEGyMMMMdhms"; // h: 12-hour notation (am/pm marker is added)
  //Some ICUs do `1:24:35 PM`, but somewhere at or before 72.1/2022e it switched to '1:24:35\u202FPM' - 202F is a Narrow NBSP. Today you learned.
  test.eq(/Saturday, October 2, 2010 AD.* 1:24:35.*PM/, localizeDate(format, value, "en"));
  test.eq(/Saturday,? 2 October 2010 AD.* 1:24:35.*pm/, localizeDate(format, value, "en-GB"));
  test.eq(/zaterdag 2 oktober 2010 n.Chr..*1:24:35.*p.m./, localizeDate(format, value, "nl"));
  // The German am/pm identifier has changed several times between "vorm."/"nachm." and "AM"/"PM". It's "vorm."/"nachm." in
  // ICU4C 60.2 (CLDR 32.0.1), which we're using for building WebHare, but changed back to "AM"/"PM" in ICU4C 62.1 (CLDR 33.1),
  // which is the current version on development systems. We'll do a like test for now.
  //TestEq("Samstag, 2. Oktober 2010 n. Chr., 1:24:35 PM", localizeDate(format, value, "de"));
  test.eq(/Samstag, 2. Oktober 2010 n. Chr..*1:24:35.*/, localizeDate(format, value, "de"));
  format = "EEEEGyMMMMdjms"; // j: locale-specific notation
  test.eq(/Saturday, October 2, 2010 AD.* 1:24:35.*PM/, localizeDate(format, value, "en"));
  test.eq(/Saturday,? 2 October 2010 AD.* 13:24:35/, localizeDate(format, value, "en-GB"));
  test.eq(/zaterdag 2 oktober 2010 n.Chr..* 13:24:35/, localizeDate(format, value, "nl"));
  test.eq(/Samstag, 2. Oktober 2010 n. Chr..* 13:24:35/, localizeDate(format, value, "de"));

  // Show 2-digit values
  format = "yyMMddHHmmss";
  test.eq("10/02/10, 13:24:35", localizeDate(format, value, "en"));
  test.eq("02/10/10, 13:24:35", localizeDate(format, value, "en-GB"));
  test.eq(/^02-10-10,? 13:24:35$/, localizeDate(format, value, "nl"));
  test.eq("02.10.10, 13:24:35", localizeDate(format, value, "de"));

  // Use and show specific timezone
  format = "yMMddjjmmssz";
  test.eq(/10\/02\/2010, 03:24:35.*PM GMT\+2/, localizeDate(format, value, "en", "Europe/Amsterdam")); // Specifying 'z' also results in 'a' being added
  test.eq("02/10/2010, 15:24:35 CEST", localizeDate(format, value, "en-GB", "Europe/Amsterdam"));
  test.eq(/^02-10-2010,? 15:24:35 CEST$/, localizeDate(format, value, "nl", "Europe/Amsterdam"));
  test.eq("02.10.2010, 15:24:35 MESZ", localizeDate(format, value, "de", "Europe/Amsterdam"));

  // Text other than symbols is ignored, format string is interpreted by locale
  format = "d EEEE 'at' j:mm";
  test.eq("2 Saturday, 1:24 PM", localizeDate(format, value, "en"));
  test.eq("Saturday 2, 13:24", localizeDate(format, value, "en-GB"));
  test.eq(/^zaterdag 2,? 13:24$/, localizeDate(format, value, "nl"));
  test.eq("Samstag, 2., 13:24", localizeDate(format, value, "de"));
}

function testOmitHareScriptDefaultValues() {
  const now = new Date;
  test.eq({
    a: 1,
    b: true,
    c: new Money("0.01"),
    d: now,
    e: [0],
    keep_a: 0,
    f: Buffer.from("1"),
    g: Uint8Array.from([1]),
    h: {},
  }, omitHareScriptDefaultValues({
    a: 1,
    b: true,
    c: new Money("0.01"),
    d: now,
    e: [0],
    f: Buffer.from("1"),
    g: Uint8Array.from([1]),
    h: {},
    keep_a: 0,
    default_a: 0,
    default_b: false,
    default_c: new Money("0.00"),
    default_d: defaultDateTime,
    default_e: [],
    default_f: undefined,
    default_g: null,
    default_h: Buffer.from(""),
    default_i: Uint8Array.from([]),
  }, ["a", "b", "c", "d", "e", "f", "g", "h", "default_a", "default_b", "default_c", "default_d", "default_e", "default_f", "default_g", "default_h", "default_i"]));

  test.eq([
    {
      a: 1,
      b: true,
      c: new Money("0.01"),
      d: now,
      e: [0],
      f: Buffer.from("1"),
      g: Uint8Array.from([1]),
      h: {},
      keep_a: 0,
    }
  ], omitHareScriptDefaultValues([
    {
      a: 1,
      b: true,
      c: new Money("0.01"),
      d: now,
      e: [0],
      f: Buffer.from("1"),
      g: Uint8Array.from([1]),
      h: {},
      keep_a: 0,
      default_a: 0,
      default_b: false,
      default_c: new Money("0.00"),
      default_d: defaultDateTime,
      default_e: [],
      default_f: undefined,
      default_g: null,
      default_h: Buffer.from(""),
      default_i: Uint8Array.from([]),
    }
  ], ["a", "b", "c", "d", "e", "f", "g", "h", "default_a", "default_b", "default_c", "default_d", "default_e", "default_f", "default_g", "default_h", "default_i"]));

  test.eq([], omitHareScriptDefaultValues([] as Array<{ a?: 0 }>, ["a"]));
}

test.runTests([
  testStrings,
  testBlobs,
  testRecordLowerBound,
  testRecordUpperBound,
  testRecordRange,
  testLowerBound,
  testUpperBound,
  testHSON,
  testWRDSupport,
  testRoundedDate,
  testLocalizeDate,
  testOmitHareScriptDefaultValues,
]);
