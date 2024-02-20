# WebHare test framework
A promise- and TypeScript-based test runner.

Basic test setup:

```typescript
import * as test from "@webhare/test";

async function myTest() {
  // Basic tests follow the form: test.eq(expectedvalue, actualvalue, annotation);
  test.eq(42, 6*7);
  // Object compares are always deep
  test.eq({ x: { y: 42 } }, { x: { y: 42 }});
  // Date objects are explicitly supported
  test.eq(new Date("2024-12-01"), new Date("2024-12-01"));
  // Test exceptions
  test.throws(/Cannot read properties of/, () => { return globalThis.nonexisting.object });
  // Test rejections
  await test.throws(/Cannot read properties of/, async () => { return globalThis.nonexisting.object });
}

test.run([ // Specify a list of tests to run
  myTest
]);
```

## TypeScript assertions
```typescript
///Verify a type is assignable to a type
test.typeAssert<test.Assignable<number, 2>>();
///Verify 2 is a number
test.typeAssert<test.Extends<2, number>>();
///Verfiy two typs are the same
test.typeAssert<test.Equals<{ a: 1; b: 2 }, { a: 1; b: 2 }>>();
```

To negate a test (ie assert a declaration is false) use the `@ts-expect-error` directive
```typescript
// @ts-expect-error -- Can't assign a number to 2
test.typeAssert<test.Assignable<2, number>>();
// @ts-expect-error -- Number doesn't extend 2
test.typeAssert<test.Extends<number, 2>>();
// @ts-expect-error -- A string is not a number
test.typeAssert<test.Equals<string, number>>();
```


## Running TypeScript code
`@webhare/test` works best if you have an environment that lets you run TypeScript code
straight from the command line. You can install `@webhare/tsrun` for this:

```bash
npm install -g @webhare/tsrun
npm install @webhare/test
tsrun mytest.ts
```
