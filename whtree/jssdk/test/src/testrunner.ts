import { TestList } from './test';
import { triggerGarbageCollection, scheduleLingeringProcessCheck } from './testsupport';

let testscompleted = false;

function onTestExit(exitCode: number) {
  if (!exitCode && !testscompleted) {
    console.error("Detected early test exit! eventloop thought it didn't need to wait anymore before the tests completed");
    process.exit(145);
  }
}

export async function run(tests: TestList, options?: object) {
  //TODO register once in case we're loaded as a module ?
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
          console.error(`Unexpected return value from test #${idx} (function ${test.name}). Make sure tests never return anything`);
          break;
        }
      } catch (e) {
        console.error(`Unexpected exception from test #${idx} (function ${test.name}):`, e);
        throw e; //TODO don't rethrow but *do* mark the tests as failed
      }
    }
    testscompleted = true;

  } finally {
    // Dump all resources keeping the script alive after 5 seconds after finishing the tests
    triggerGarbageCollection();
    scheduleLingeringProcessCheck();
  }
}
