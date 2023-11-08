import { omit, pick } from "@webhare/std";
import { executeEnrichment, freezeRecursive, Merge, OptionalKeys, RecursivePartial, RequiredKeys, Simplify } from "@mod-system/js/internal/util/algorithms";
import * as test from "@webhare/test";
import { RecursiveReadOnly } from "@webhare/js-api-tools";


function testPick() {
  test.eq({ a: 1, b: 2 }, pick({ a: 1, b: 2, c: 3 }, ["a", "b"]));
  test.eq([{ a: 1, b: 2 }], pick([{ a: 1, b: 2, c: 3 }], ["a", "b"]));

  // @ts-expect-error -- May not mention keys that don't exist in the type
  test.eq({ a: 1, b: 2 }, pick({ a: 1, b: 2, c: 3 }, ["a", "b", "d"]));

  // @ts-expect-error -- May not mention keys that don't exist in the type
  test.eq([{ a: 1, b: 2 }], pick([{ a: 1, b: 2, c: 3 }], ["a", "b", "d"]));
}

function testOmit() {
  test.eq({ a: 1, b: 2 }, omit({ a: 1, b: 2, c: 3 }, ["c"]));
  test.eq([{ a: 1, b: 2 }], omit([{ a: 1, b: 2, c: 3 }], ["c"]));

  // @ts-expect-error -- May not mention keys that don't exist in the type
  test.eq({ a: 1, b: 2 }, omit({ a: 1, b: 2, c: 3 }, ["c", "d"]));

  // @ts-expect-error -- May not mention keys that don't exist in the type
  test.eq([{ a: 1, b: 2 }], omit([{ a: 1, b: 2, c: 3 }], ["c", "d"]));
}

function testFreezeRecursive() {
  const value = { a: [{ b: { c: 1 } }] };
  freezeRecursive(value);
  test.throws(/Cannot assign to read only property 'c' of object '#<Object>'/, () => value.a[0].b.c = 2);
  test.throws(/Cannot add property 1, object is not extensible/, () => value.a.push({ b: { c: 3 } }));
}

function testTypes() {
  test.typeAssert<test.Equals<{ readonly a: ReadonlyArray<{ readonly b: number }> }, RecursiveReadOnly<{ a: Array<{ b: number }> }>>>();

  test.typeAssert<test.Equals<{ a?: Array<{ b?: number }> }, RecursivePartial<{ a: Array<{ b: number }> }>>>();

  test.typeAssert<test.Equals<"a" | "c", RequiredKeys<{ a: 1; b?: undefined; c: undefined }>>>();
  test.typeAssert<test.Equals<"b", OptionalKeys<{ a: 1; b?: undefined; c: undefined }>>>();
  test.typeAssert<test.Equals<{ a: 1 } & { b: 2; c: 2 }, Merge<{ a: 1; b: 1 }, { b: 2; c: 2 }>>>();
  test.typeAssert<test.Equals<{ a: 1; b: 2 } | { a: 2; b: 3 }, Simplify<{ a: 1 } & { b: 2 } | { a: 2 } & { b: 3 }>>>();
  test.typeAssert<test.Equals<{ a: 1; b: 2 } | { a: 2; b: 3 }, Simplify<{ a: 1 } & { b: 2 } | { a: 2 } & { b: 3 }>>>();
}

async function testExecuteEnrichment() {
  const innerJoinTest = await executeEnrichment([
    { a: 2 },
    { a: 1 }
  ], "a", {
  }, async (ids, lor, cs) => {
    return new Map([
      [2, { c: 2 }],
      [1, { a: 5, c: 3 }], // overrides a!
    ]);
  }, null, null);

  test.eq([
    { a: 2, c: 2 },
    { a: 5, c: 3 }
  ], innerJoinTest);

  test.typeAssert<test.Equals<Array<{ a: number; c: number }>, typeof innerJoinTest>>();

  const rightOuterJoinTest = await executeEnrichment([
    { a: 2 },
    { a: 1 }
  ], "a", {
  }, async (ids, lor, cs) => {
    return new Map([[2, { c: 2 }]]);
  }, null, () => ({ c: 4 }));

  test.eq([
    { a: 2, c: 2 },
    { a: 1, c: 4 }
  ], rightOuterJoinTest);

  test.typeAssert<test.Equals<Array<{ a: number; c: number } | { a: number; c: number }>, typeof rightOuterJoinTest>>();

  const leftOuterJoinTest = await executeEnrichment([{ a: 2 }], "a", {
  }, async (ids, lor, cs) => {
    return new Map([
      [2, { c: 2 }],
      [3, { c: 4 }],
    ]);
  },
    () => ({ a: 3 }), null);

  test.eq([
    { a: 2, c: 2 },
    { a: 3, c: 4 }
  ], leftOuterJoinTest);

  test.typeAssert<test.Equals<Array<{ a: number; c: number } | { a: number; c: number }>, typeof leftOuterJoinTest>>();

  const allTest = await executeEnrichment([{ a: 1, b: 2 }, { a: 2, b: 3 }], "a", {
  }, async (ids, lor, cs) => {
    // Need an explicit type here, otherwise `{c:number;type:string} | {c:number;type?:undefined}` is inferred.
    const data: Array<[number, { c: number; type?: string }]> = [
      [1, { c: 2, type: "innerJoin" }],
      [3, { c: 3 }],
    ];
    return new Map(data);
  },
    () => ({ a: 3, b: 4, type: "leftOuterJoin" }),
    () => ({ c: 4, type: "rightOuterJoin" }));

  test.eq([
    { a: 1, b: 2, c: 2, type: "innerJoin" },
    { a: 2, b: 3, c: 4, type: "rightOuterJoin" },
    { a: 3, b: 4, c: 3, type: "leftOuterJoin" },
  ], allTest);

  test.typeAssert<test.Equals<Array<
    { a: number; b: number; c: number; type: string } |
    { a: number; b: number; c: number; type?: string } // caused by the missing type in the second getBulkFields return value
  >, typeof allTest>>();

  const presentFieldTest = await executeEnrichment([{ a: 1, b: 2 }, { a: 2, b: 3 }], "a", {
    presentfield: "present"
  }, async (ids, lor, cs) => {
    return new Map([
      [1, { c: 2 }],
      [3, { c: 3 }],
    ]);
  },
    () => ({ a: 3, b: 4 }),
    () => ({ c: 4 }));

  test.eq([
    { a: 1, b: 2, c: 2, present: "both" },
    { a: 2, b: 3, c: 4, present: "left" },
    { a: 3, b: 4, c: 3, present: "right" },
  ], presentFieldTest);

  test.typeAssert<test.Equals<Array<
    { a: number; b: number; c: number; present: "both" } |
    { a: number; b: number; c: number; present: "left" } |
    { a: number; b: number; c: number; present: "right" } // caused by the missing type in the second getBulkFields return value
  >, typeof presentFieldTest>>();
}

test.run([
  testPick,
  testOmit,
  testFreezeRecursive,
  testTypes,
  testExecuteEnrichment,
]);
