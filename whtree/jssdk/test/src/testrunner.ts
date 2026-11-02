import type { TestList } from './test';
import { triggerGarbageCollection, scheduleLingeringProcessCheck } from './testsupport';
import { runTests as runFrontendTests } from "@webhare/test-frontend/src/suite-support";

let testscompleted = false;

type TestFinalizer = {
  onCatch?: () => void | Promise<void>;
  onDone?: () => void | Promise<void>;
};

const finalizers = new Array<TestFinalizer>();

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
    let nextTestTitle = '';
    for (; idx < tests.length; ++idx) {
      const test = tests[idx];
      if (typeof test === "string") {
        nextTestTitle = test;
        continue;
      }

      const testTitle = nextTestTitle || test.name;
      const testName = `test ${idx + 1}/${tests.length}${testTitle ? `: ${testTitle}` : ""}`;
      // console.log(`⏳ ${new Date().toISOString()} ${testName}`);
      console.log(`---- ${new Date().toISOString()} --- ${testName} -------------`.padEnd(78, '-'));
      const testStart = performance.now();

      try {
        const result = await test();
        if (typeof result !== "undefined") {
          // this may be accidentally passing a non test-function eg testing `() => myTest` instead of `() => myTest()`
          throw new Error(`Unexpected return value from test #${idx} (function ${test.name}). Make sure tests never return anything`);
        }
        console.log(`✅ Success: ${testName} (${(performance.now() - testStart).toFixed(3)} ms)\n`);
      } catch (e) {
        console.log(`❌ Failed: ${testName} (${(performance.now() - testStart).toFixed(3)} ms)\n`);
        console.error(e);
        await Promise.all(finalizers.map(finalizer => finalizer.onCatch?.())).catch(err => {
          console.error("Ignoring exception from finalizer onCatch:", err);
        });
        throw e;
      }
    }
    testscompleted = true;

  } finally {
    if (typeof process !== "undefined") {
      await Promise.all(finalizers.map(finalizer => finalizer.onDone?.())).catch(err => {
        console.error("Ignoring exception from finalizer onDone:", err);
      });
      await triggerGarbageCollection();

      // Dump all resources keeping the script alive after 5 seconds after finishing the tests
      scheduleLingeringProcessCheck();
    }
  }
}

export function addTestFinalizer(finalizer: TestFinalizer) {
  if (typeof process === "undefined")
    throw new Error(`addTestFinalizer is not supported for frontend tests yet`);

  finalizers.push(finalizer);
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
