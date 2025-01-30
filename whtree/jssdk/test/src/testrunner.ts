import type { TestList } from './test';
import { triggerGarbageCollection, scheduleLingeringProcessCheck } from './testsupport';
import { runTests as runFrontendTests } from "@mod-system/js/wh/testframework";

let testscompleted = false;

function onTestExit(exitCode: number) {
  if (!exitCode && !testscompleted) {
    console.error("Detected early test exit! eventloop thought it didn't need to wait anymore before the tests completed");
    if (typeof process !== "undefined")
      process.exit(145);
  }
}

async function asyncRun(tests: TestList, options?: object) {
  //TODO register once in case we're loaded as a module ?
  if (typeof process !== "undefined")
    process.on("exit", onTestExit);
  let idx = 0;

  try {
    for (; idx < tests.length; ++idx) {
      const test = tests[idx];
      if (typeof test === "string") {
        console.log(`Test: ${test}`);
        continue;
      }
      try {

        const result = await test();
        if (typeof result !== "undefined") {
          // this may be accidentally passing a non test-function eg testing `() => myTest` instead of `() => myTest()`
          throw new Error(`Unexpected return value from test #${idx} (function ${test.name}). Make sure tests never return anything`);
        }
      } catch (e) {
        console.error(`Unexpected exception from test #${idx} (function ${test.name}):`, e);
        throw e; //TODO don't rethrow but *do* mark the tests as failed
      }
    }
    testscompleted = true;

  } finally {
    // Dump all resources keeping the script alive after 5 seconds after finishing the tests
    if (typeof process !== "undefined") {
      await triggerGarbageCollection();
      scheduleLingeringProcessCheck();
    }
  }
}

/** Run tests
 * @param tests - List of tests to run
 * @param options - Options. onDone: function to call when all tests are done (whether succesful or not)
 */
export function runTests(tests: TestList, options?: { onDone?: () => void }): void {
  if (typeof process !== "undefined") {
    /* We've set up an onDone instead of a promise because 99% of the test scripts don't actually want to await test.runTests
      and the 1% which did want that is working around lingering resource bugs */
    void asyncRun(tests, options).finally(() => {
      options?.onDone?.();
    });
  } else {
    if (options?.onDone)
      throw new Error("onDone is not supported yet in the browser");
    runFrontendTests(tests);
  }
}
