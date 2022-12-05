// Want more than the default 10 stack frames in errors
Error.stackTraceLimit = 25;

export {
  assert
  , eq
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


  for (const test of tests) {
    await test();
  }
  testscompleted = true;
}
