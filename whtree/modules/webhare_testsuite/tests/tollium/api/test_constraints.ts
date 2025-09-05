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

  //see if we properly deal with undefined
  if (expect) {
    const allkeys = new Set([...Object.keys(lhs || {}), ...Object.keys(rhs || {})]);
    const allundefined = Object.fromEntries([...allkeys].map(keyName => [keyName, undefined]));
    test.eq(expect, mergeConstraints({ ...allundefined, ...lhs }, { ...allundefined, ...rhs }));
  }
}

function testValueConstraints() {
  testConstraintMerge(null, null, null);
  testConstraintMerge({ minValue: 2048 }, null, { minValue: 2048 });
  testConstraintMerge({ minValue: 4096 }, { minValue: 4096 }, { minValue: 2048 });
  testConstraintMerge({ maxValue: 2048 }, null, { maxValue: 2048 });
  testConstraintMerge({ maxValue: 2048 }, { maxValue: 4096 }, { maxValue: 2048 });
  testConstraintMerge({ maxBytes: 2048 }, null, { maxBytes: 2048 });
  testConstraintMerge({ maxBytes: 2048 }, { maxBytes: 4096 }, { maxBytes: 2048 });
  testConstraintMerge({ maxBytes: 4096, required: true }, { required: true }, { maxBytes: 4096 });
  testConstraintMerge({ valueType: 'integer', minValue: 0, maxValue: 217483647 }, { valueType: 'integer', minValue: -217483648, maxValue: 217483647 }, { minValue: 0 });
}

function testTolliumMapping() {
  test.eqPartial({ error: /without a valueType/ }, suggestTolliumComponent({}));

  //valueConstraints shouldn't directly appear as explicit properties to assign to the component, as the user might overwrite them anyway
  test.eqPartial({ component: { textedit: { valueConstraints: { required: true } }, required: undefined } }, suggestTolliumComponent({ valueType: "string", required: true }));

  //textedit '30x' default width may be considered a mistake in retrospect? but we can change the default for YAML profiles
  test.eqPartial({ component: { textedit: { width: "1pr" } } }, suggestTolliumComponent({ valueType: "string" }));
  //tollium generally assumed 'setting witdh to maxLength + 1x, up to 30, is a good default'. we'll follow the same line except that at 30+ we'll go straight to 1pr widths
  test.eqPartial({ component: { textedit: { width: "21x" } } }, suggestTolliumComponent({ valueType: "string", maxLength: 20 }));
  test.eqPartial({ component: { textedit: { width: "30x" } } }, suggestTolliumComponent({ valueType: "string", maxLength: 29 }));
  test.eqPartial({ component: { textedit: { width: "1pr" } } }, suggestTolliumComponent({ valueType: "string", maxLength: 30 }));

  //date precisions default to millisecond (as that's the least constraint)
  test.eqPartial({ component: { datetime: { valueConstraints: { precision: "millisecond" }, type: "datetime", storeUTC: true } } }, suggestTolliumComponent({ valueType: "dateTime" }));
  test.eqPartial({ component: { datetime: { valueConstraints: { precision: "second" }, type: "datetime", storeUTC: true } } }, suggestTolliumComponent({ valueType: "dateTime", precision: "second" }));
  test.eqPartial({ component: { datetime: { valueConstraints: { precision: "minute" }, type: "datetime", storeUTC: true } } }, suggestTolliumComponent({ valueType: "dateTime", precision: "minute" }));
  test.eqPartial({ component: { datetime: { valueConstraints: { precision: "hour" }, type: "datetime", storeUTC: true } } }, suggestTolliumComponent({ valueType: "dateTime", precision: "hour" }));

  test.eqPartial({ component: { datetime: { valueConstraints: { precision: undefined }, type: "date", storeUTC: false } } }, suggestTolliumComponent({ valueType: "date" }));

  //file and image
  test.eqPartial({ component: { fileedit: {} } }, suggestTolliumComponent({ valueType: "file" }));
  test.eqPartial({ component: { imgedit: {} } }, suggestTolliumComponent({ valueType: "image" }));
}

test.runTests([
  testValueConstraints,
  testTolliumMapping
]);
