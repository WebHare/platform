import { omit, pick } from "@webhare/std";
import { freezeRecursive, RecursivePartial, RecursiveReadOnly } from "@mod-system/js/internal/util/algorithms";
import * as test from "@webhare/test";


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
}

test.run([
  testPick,
  testOmit,
  testFreezeRecursive,
  testTypes
]);
