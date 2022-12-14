// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

export {
  assert
  , eq
  , eqMatch
  , eqProps
  , sleep
  , throws
  , setupLogging
} from './checks';
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


  for (let idx = 0; idx < tests.length; ++idx) {
    const result = await tests[idx]();
    if(typeof result !== "undefined") {
      // this may be accidentally passing a non test-function eg testing `() => myTest` instead of `() => myTest()`
      console.error(`Unexpected return value from test #${idx} (${tests[idx].name}). Make sure tests never return anything`);
      break;
    }
  }
  testscompleted = true;
}
