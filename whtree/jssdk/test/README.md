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

## Running TypeScript code
`@webhare/test` works best if you have an environment that lets you run TypeScript code
straight from the command line. You can install `@webhare/tsrun` for this:

```bash
npm install -g @webhare/tsrun
npm install @webhare/test
tsrun mytest.ts
```
