import { triggerGarbageCollection, scheduleLingeringProcessCheck } from './testsupport';
export { triggerGarbageCollection } from './testsupport';

// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

const startTime = new Date;

export {
  assert,
  eq,
  eqMatch,
  eqProps,
  throws,
  setupLogging,
  wait,
  loadTSType,
  loadJSONSchema,
  Equals,
  RevEquals,
  Assignable,
  Extends,
  typeAssert,
} from './checks';

export { sleep } from "@webhare/std";

export { startTime };

let testscompleted = false;

function onTestExit(exitCode: number) {
  if (!exitCode && !testscompleted) {
    console.error("Detected early test exit! eventloop thought it didn't need to wait anymore before the tests completed");
    process.exit(145);
  }
}

export async function run(tests: Array<() => unknown>, options?: object) {
  //TODO register once in case we're loaded as a module ?
  process.on("exit", onTestExit);
  let idx = 0;
  try {
    for (; idx < tests.length; ++idx) {
      const result = await tests[idx]();
      if (typeof result !== "undefined") {
        // this may be accidentally passing a non test-function eg testing `() => myTest` instead of `() => myTest()`
        console.error(`Unexpected return value from test #${idx} (${tests[idx].name}). Make sure tests never return anything`);
        break;
      }
    }
    testscompleted = true;
  } catch (e) {
    console.error(`Unexpected exception from test #${idx} (${tests[idx].name}):`, e);
    throw e; //TODO don't rethrow but *do* mark the tests as failed
  } finally {
    // Dump all resources keeping the script alive after 5 seconds after finishing the tests
    triggerGarbageCollection();
    scheduleLingeringProcessCheck();
  }
}
