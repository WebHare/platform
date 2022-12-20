import * as test from '@webhare/test';
import bridge from '@mod-system/js/internal/bridge';

// import * as util from 'node:util';
import * as child_process from 'node:child_process';

async function testChecks() {
  //test.throws should fail if a function did not throw. this will generate noise so tell the user to ignore
  await test.throws(/Lemme throw/, () => { throw new Error("Lemme throw"); });
  await test.throws(/Expected function to throw/, () => test.throws(/Fourty two/, () => 42));
  console.log("(you can ignore the message above about expecting a fourty two exception)");

  const x_ab = { cellA: "A", cellB: "B" };
  const x_abc = { ...x_ab, cellC: "test" };

  test.eqProps(x_ab, x_ab);
  test.eqProps(x_ab, x_abc);
  test.eqProps(x_abc, x_ab, ["cellC"], "shouldn't throw if cellC is explicitly ignored");
  await test.throws(/Expected property 'cellC'.*at root/, () => test.eqProps(x_abc, x_ab));

  const x_abc_badb = { ...x_abc, cellB: "BAD" };
  test.eqProps(x_abc, x_abc_badb, ["cellB"], "shouldn't throw if cellB is explicitly ignored");
  await test.throws(/Mismatched value at root.cellB/, () => test.eqProps(x_abc, x_abc_badb));

  {

    const v_ts = await test.loadTSType(`@mod-webhare_testsuite/tests/system/nodejs/test_tests.ts#MyInterface`);
    await test.throws(/data does not conform to the structure: "\/b" must be string/, () => v_ts.validateStructure({ a: 0, b: 1 }), "wrong type not detected");
    await test.throws(/must NOT have additional properties/, () => v_ts.validateStructure({ a: 0, b: "a", c: "1" }), "extra property not detected");
    await test.throws(/must have required property 'b'/, () => v_ts.validateStructure({ a: 0 }), "missing property not detected");
    v_ts.validateStructure({ a: 0, b: "a" });
  }

  {
    const v_ts_allow_extra = await test.loadTSType(`@mod-webhare_testsuite/tests/system/nodejs/test_tests.ts#MyInterface`, { noExtraProps: false, required: false });
    v_ts_allow_extra.validateStructure({ a: 0, c: "1" });
  }

  {
    const v_js = await test.loadJSONSchema({ "type": "object", "properties": { "a": { "type": "number" }, "b": { "type": "string" } }, "$schema": "http://json-schema.org/draft-07/schema#" });
    v_js.validateStructure({ a: 0, c: "1" });
    await test.throws(/data does not conform to the structure: "\/b" must be string/, () => v_js.validateStructure({ a: 0, b: 1 }), "wrong type not detected");
  }

  {
    const v_jsf = await test.loadJSONSchema("@mod-webhare_testsuite/tests/system/nodejs/data/test.schema.json");
    await test.throws(/data does not conform to the structure: "\/b" must be string/, () => v_jsf.validateStructure({ a: 0, b: 1 }), "wrong type not detected");
    await test.throws(/must NOT have additional properties/, () => v_jsf.validateStructure({ a: 0, b: "a", c: "1" }), "extra property not detected");
    await test.throws(/must have required property 'b'/, () => v_jsf.validateStructure({ a: 0 }), "missing property not detected");
    v_jsf.validateStructure({ a: 0, b: "a" });
  }


  {
    const start = Date.now();
    await test.throws(/test.wait timed out after 10 ms/, () => test.wait(() => false, { timeout: 10 }));
    const waited = Date.now() - start;
    test.assert(waited >= 10, `test.wait didn't wait at least 10ms, but ${waited}ms`);
  }

  {
    const start = Date.now();
    await test.throws(/test.wait timed out after 10 ms/, () => test.wait(new Promise(() => null), { timeout: 10 }));
    const waited = Date.now() - start;
    test.assert(waited >= 10, `test.wait didn't wait at least 10ms, but ${waited}ms`);
  }

  {
    const start = Date.now();
    await test.throws(/test.wait timed out after 10 ms/, () => test.wait(() => Promise.resolve(false), { timeout: 10 }));
    const waited = Date.now() - start;
    test.assert(waited >= 10, `test.wait didn't wait at least 10ms, but ${waited}ms`);
  }

  await test.wait(new Promise(resolve => resolve({ a: 1 })));
  await test.wait(new Promise(resolve => resolve(false)));
  await test.wait(() => Promise.resolve(true));
}

// Referenced by file#symbol reference in the loadTSType call above
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface MyInterface {
  a: number;
  b: string;
}

async function runWHTest(testname: string): Promise<string> {
  await bridge.ready;

  /* TODO: a much better approach would use child_process.spawn and pipes, merge the stdout&stderr pipe (so there are no ordering issues) and also watch the exit code */
  return new Promise(resolve =>
    child_process.execFile(bridge.getInstallationRoot() + "bin/wh", ["runtest", testname], { timeout: 30000 }, function(error, stdout, stderr) {
      // console.log({error, stdout, stderr});
      resolve(stdout + stderr);
    }));
}

async function checkTestFailures() {
  test.eqMatch(/test\.assert failed.*metatest_shouldfail.ts line 4.*Offending test: test\.assert\(Math\.random\(\) === 42\);/s, await runWHTest("system.nodejs.meta.metatest_shouldfail"));
}

test.run([
  testChecks,
  checkTestFailures
]);
