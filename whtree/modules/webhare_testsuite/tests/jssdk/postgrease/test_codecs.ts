


import { stringify } from "@webhare/std";
import * as test from "@webhare/test-backend";
import { connect, bindParam, type PGConnection, CodecRegistry, defaultCodecs } from "@webhare/postgrease";
import { __setJITDecoderEnabled } from "@webhare/postgrease/src/codec-support";

async function testCodec(conn: PGConnection, type: string, tests: {
  encodings: Record<string, { decoded: any; moreToEncode?: any[] }>;
  encodeErrors?: { value: any; message: RegExp }[];
}) {
  const codec = conn["defaultCodecRegistry"].getCodecByName(type);
  test.assert(codec, `Codec for type ${type} not found`);
  for (const [encoded, testData] of Object.entries(tests.encodings)) {
    const res = await conn.query(`SELECT $1::${type} AS val`, [encoded]);
    test.eq(testData.decoded, res.rows[0].val, `Codec test for type ${type} encoding ${encoded}`);

    for (const v of [testData.decoded, ...(testData.moreToEncode ?? [])]) {
      test.eq(true, conn["defaultCodecRegistry"].testValue(codec, v), `Codec test rejected valid value: ${stringify(v, { typed: true })}`);
      const res2 = await conn.query(`SELECT $1::text AS val`, [bindParam(v, type)]);
      test.eq(encoded, res2.rows[0].val, `Codec test for type ${type} decoding ${stringify(v, { typed: true })}`);
    }
  }
  for (const encodeErrorTest of tests.encodeErrors ?? []) {
    await test.throws(encodeErrorTest.message, () => conn.query(`SELECT $1 AS val`, [bindParam(encodeErrorTest.value, type)]));
    test.eq(false, conn["defaultCodecRegistry"].testValue(codec, encodeErrorTest.value), "Codec test accepted invalid value");
  }
}

async function testCodecs() {
  const pgclient = await connect({
    port: parseInt(process.env.PGPORT!) || 5432,
    host: (process.env.WEBHARE_PGHOST ?? process.env.PGHOST) || "",
    user: "postgres",
    database: process.env.WEBHARE_DBASENAME || "",
  });

  await testCodec(pgclient, "bool", {
    encodings: {
      "true": { decoded: true },
      "false": { decoded: false },
    },
    encodeErrors: [
      { value: "notabool", message: /Invalid bool value/ },
      { value: 123, message: /Invalid bool value/ }
    ]
  });

  await testCodec(pgclient, "int2", {
    encodings: {
      "0": { decoded: 0 },
      "-32768": { decoded: -32768 },
      "32767": { decoded: 32767 },
    },
    encodeErrors: [
      { value: -32769, message: /Invalid int2 value/ },
      { value: 32768, message: /Invalid int2 value/ },
      { value: true, message: /Invalid int2 value/ },
      { value: 3.13, message: /Invalid int2 value/ },
    ]
  });


  // int4
  await testCodec(pgclient, "int4", {
    encodings: {
      "0": { decoded: 0 },
      "-2147483648": { decoded: -2147483648 },
      "2147483647": { decoded: 2147483647 },
    },
    encodeErrors: [
      { value: -2147483649, message: /Invalid int4 value/ },
      { value: 2147483648, message: /Invalid int4 value/ },
      { value: true, message: /Invalid int4 value/ },
      { value: 3.13, message: /Invalid int4 value/ },
    ]
  });

  // int8
  await testCodec(pgclient, "int8", {
    encodings: {
      "0": { decoded: 0 },
      "-4503599627370496": { decoded: -4503599627370496 },
      "4503599627370496": { decoded: 4503599627370496 },
      "-9223372036854775808": { decoded: -9223372036854775808n },
      "9223372036854775807": { decoded: 9223372036854775807n },
    },
    encodeErrors: [
      { value: -9223372036854775809n, message: /Invalid int8 value/ },
      { value: 9223372036854775808n, message: /Invalid int8 value/ },
      { value: true, message: /Invalid int8 value/ },
      { value: 3.13, message: /Invalid int8 value/ },
    ]
  });

  // float4
  await testCodec(pgclient, "float4", {
    encodings: {
      "0": { decoded: 0 },
      "3.14": { decoded: 3.140000104904175 },
      "-2.71": { decoded: -2.7100000381469727 },
    },
    encodeErrors: [
      { value: "notafloat", message: /Invalid float4 value/ },
      { value: true, message: /Invalid float4 value/ },
    ]
  });

  // float8
  await testCodec(pgclient, "float8", {
    encodings: {
      "0": { decoded: 0 },
      "3.141592653589793": { decoded: 3.141592653589793 },
      "-2.718281828459045": { decoded: -2.718281828459045 },
    },
    encodeErrors: [
      { value: "notafloat", message: /Invalid float8 value/ },
      { value: true, message: /Invalid float8 value/ },
    ]
  });

  // text
  await testCodec(pgclient, "text", {
    encodings: {
      "hello": { decoded: "hello" },
      "": { decoded: "" },
      "こんにちは": { decoded: "こんにちは" },
    },
    encodeErrors: [
      { value: undefined, message: /Invalid text value/ },
      { value: 12, message: /Invalid text value/ },
    ]
  });

  // bytea
  await testCodec(pgclient, "bytea", {
    encodings: {
      "\\x68656c6c6f": { decoded: Buffer.from("hello") },
      "\\x": { decoded: Buffer.from([]) },
    },
    encodeErrors: [
      { value: "notbytes", message: /Invalid bytea value/ },
      { value: 123, message: /Invalid bytea value/ },
    ]
  });

  // timestamp
  await testCodec(pgclient, "timestamp", {
    encodings: {
      "2024-01-01 12:34:56": { decoded: new Date("2024-01-01T12:34:56Z") },
      "1999-12-31 23:59:59": { decoded: new Date("1999-12-31T23:59:59Z"), moreToEncode: [Temporal.Instant.from("1999-12-31T23:59:59Z")] },
    },
    encodeErrors: [
      { value: "notatimestamp", message: /Invalid timestamp value/ },
      { value: true, message: /Invalid timestamp value/ },
    ]
  });

  // uuid
  await testCodec(pgclient, "uuid", {
    encodings: {
      "123e4567-e89b-12d3-a456-426614174000": { decoded: "123e4567-e89b-12d3-a456-426614174000" },
      "00000000-0000-0000-0000-000000000000": { decoded: "00000000-0000-0000-0000-000000000000" },
    },
    encodeErrors: [
      { value: "notauuid", message: /Invalid uuid value/ },
      { value: true, message: /Invalid uuid value/ },
    ]
  });

  // json
  await testCodec(pgclient, "json", {
    encodings: {
      '{"a":1,"b":2}': { decoded: { a: 1, b: 2 } },
      'true': { decoded: true },
      '42': { decoded: 42 },
    },
    encodeErrors: [
      { value: undefined, message: /Invalid json value/ },
      { value: () => { }, message: /Invalid json value/ },
      { value: "\x00", message: /Invalid json value/ },
    ]
  });

  // jsonb
  await testCodec(pgclient, "jsonb", {
    encodings: {
      '{"a": 1, "b": 2}': { decoded: { a: 1, b: 2 } },
      'true': { decoded: true },
      '42': { decoded: 42 },
    },
    encodeErrors: [
      { value: undefined, message: /Invalid jsonb value/ },
      { value: () => { }, message: /Invalid jsonb value/ },
      { value: "\x00", message: /Invalid jsonb value/ },
    ]
  });

  await pgclient.close();
}

function testRegistry() {
  const registry = new CodecRegistry(defaultCodecs);

  test.eq("int2", registry.determineCodec(1)?.name);
  test.eq("int4", registry.determineCodec(32768)?.name);
  test.eq("int8", registry.determineCodec(2 ** 31)?.name);
  test.eq("float8", registry.determineCodec(2 ** 53)?.name);
  test.eq("float8", registry.determineCodec(0.1)?.name);
  test.eq("int8", registry.determineCodec(1n)?.name);
  test.eq("bool", registry.determineCodec(true)?.name);
  test.eq("bool", registry.determineCodec(false)?.name);
  test.eq("text", registry.determineCodec("hello")?.name);
  test.eq("unknown", registry.determineCodec(null)?.name);
  test.eq("timestamptz", registry.determineCodec(new Date)?.name);
  test.eq("timestamptz", registry.determineCodec(Temporal.Now.instant())?.name);

  test.eq("_int2", registry.determineCodec([1])?.name);
  test.eq("_int2", registry.determineCodec([null, 1, 2])?.name);
  test.eq("_int4", registry.determineCodec([32768])?.name);
  test.eq("_int4", registry.determineCodec([null, 1, 32768, 32769])?.name);
  test.eq("_int8", registry.determineCodec([2 ** 31])?.name);
  test.eq("_int8", registry.determineCodec([null, 1, 2 ** 31, 2 ** 32])?.name);
  test.eq("_float8", registry.determineCodec([0.1])?.name);
  test.eq("_float8", registry.determineCodec([2 ** 53])?.name);
  test.eq("_float8", registry.determineCodec([null, 1, 0.1, 0.2])?.name);
  test.eq("_int8", registry.determineCodec([1n])?.name);
  test.eq("_int8", registry.determineCodec([null, 1n, 2n])?.name);
  test.eq("_bool", registry.determineCodec([true])?.name);
  test.eq("_bool", registry.determineCodec([false])?.name);
  test.eq("_text", registry.determineCodec(["hello"])?.name);
  test.eq("_text", registry.determineCodec([null, "hello"])?.name);
  test.eq("_text", registry.determineCodec([])?.name);
  test.eq("_text", registry.determineCodec([null, null])?.name);

  test.eq(null, registry.determineCodec(() => 0));
}

test.runTests([
  testCodecs,
  () => __setJITDecoderEnabled(false),
  testCodecs,
  () => __setJITDecoderEnabled(true),
  testRegistry
]);
