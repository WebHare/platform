import { mergeConstraints, suggestTolliumComponent, type ValueConstraints } from "@mod-platform/js/tollium/valueconstraints";
import * as test from "@webhare/test";

function testConstraintMerge(expect: ValueConstraints | null, lhs: ValueConstraints | null, rhs: ValueConstraints | null) {
  //order should not matter:
  test.eq(expect, mergeConstraints(lhs, rhs));
  test.eq(expect, mergeConstraints(rhs, lhs));
  //merging any constraint with the expected value should simply return the expected value
  test.eq(expect, mergeConstraints(expect, lhs));
  test.eq(expect, mergeConstraints(expect, rhs));
  test.eq(expect, mergeConstraints(lhs, expect));
  test.eq(expect, mergeConstraints(rhs, expect));
}

function testValueConstraints() {
  testConstraintMerge(null, null, null);
  testConstraintMerge({ minValue: 2048 }, null, { minValue: 2048 });
  testConstraintMerge({ minValue: 4096 }, { minValue: 4096 }, { minValue: 2048 });
  testConstraintMerge({ maxValue: 2048 }, null, { maxValue: 2048 });
  testConstraintMerge({ maxValue: 2048 }, { maxValue: 4096 }, { maxValue: 2048 });
  testConstraintMerge({ maxBytes: 2048 }, null, { maxBytes: 2048 });
  testConstraintMerge({ maxBytes: 2048 }, { maxBytes: 4096 }, { maxBytes: 2048 });
}

function testTolliumMapping() {
  test.eqPartial({ component: { textEdit: { valueConstraints: { required: true } } } }, suggestTolliumComponent({ valueType: "string", required: true }));
  test.eqPartial({ error: /without a valueType/ }, suggestTolliumComponent({}));
}

test.run([
  testValueConstraints,
  testTolliumMapping
]);
