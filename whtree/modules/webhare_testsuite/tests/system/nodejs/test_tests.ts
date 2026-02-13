import * as test from '@webhare/test';
import { TestMonitor } from '@webhare/test/src/monitor';
import * as services from '@webhare/services';
import * as std from '@webhare/std';

// import * as util from 'node:util';
import * as child_process from 'node:child_process';

async function testChecks() {
  //test.throws should fail if a function did not throw. this will generate noise so tell the user to ignore
  test.throws(/Lemme throw/, () => { throw new Error("Lemme throw"); });
  test.throws(/Expected function to throw/i, () => test.throws(/Fourty two/, () => 42));
  console.log("(you can ignore the message above about expecting a fourty two exception)");

  //test JS native Date type
  test.eq(new Date("2023-01-01"), new Date("2023-01-01"));
  test.eq({ deep: new Date("2023-01-01") }, { deep: new Date("2023-01-01") });
  test.eqPartial({ deep: new Date("2023-01-01") }, { deep: new Date("2023-01-01") });
  test.throws(/Expected Date/, () => test.eq(new Date("2023-01-02"), new Date("2023-01-01")));
  test.throws(/Expected Date/, () => test.eq({ deep: new Date("2023-01-02") }, { deep: new Date("2023-01-01") }));
  test.throws(/Expected Date/, () => test.eqPartial({ deep: new Date("2023-01-02") }, { deep: new Date("2023-01-01") }));

  //test Temporal types
  test.eq(Temporal.Instant.from("2023-01-01T00:00:00Z"), Temporal.Instant.fromEpochMilliseconds(Date.parse("2023-01-01")));
  test.throws(/Expected Instant:.*actual/, () => test.eq(Temporal.Instant.from("2023-01-01T00:00:00Z"), Temporal.Instant.fromEpochMilliseconds(Date.parse("2022-01-01"))));

  //Test promises not evaluating to true
  test.throws(/Passing a Promise/, () => test.eq(Promise.resolve(1), Promise.resolve(1)));
  test.throws(/Passing a Promise/, () => test.eq(Promise.resolve(1), Promise.resolve(2)));

  //test Sets
  test.eq(new Set([1, 2, 3]), new Set([3, 2, 1]));
  test.eq(new Set([]), new Set([]));
  test.throws(/Missing 2 elements and 2 unexpected elements/, () => test.eq(new Set([1, 2]), new Set([3, 4])));

  //test WH Money type
  test.eq(std.Money.fromNumber(2.5), new std.Money("2.5"));
  test.eq(new std.Money("2.5"), new std.Money("2.500"));
  test.eqPartial({ deep: new std.Money("2.5") }, { deep: new std.Money("2.500") });
  ///@ts-expect-error -- TS shouldn't like the type mismatch either
  test.throws(/Expected type: Money/, () => test.eq(new std.Money("2.5"), 2.5));
  ///@ts-expect-error -- TS shouldn't like the type mismatch either
  test.throws(/Expected type: number/, () => test.eq(2.5, new std.Money("2.5")));
  test.throws(/Expected match/, () => test.eq(new std.Money("2.5"), new std.Money("1.5")));

  //test RegEx vs strings
  test.eq(/konijntje/, "Heb jij mijn konijntje gezien?");
  test.eqPartial(/konijntje/, "Heb jij mijn konijntje gezien?");
  test.eq({ text: /konijntje/ }, { text: "Heb jij mijn konijntje gezien?" });
  test.eqPartial({ text: /konijntje/ }, { text: "Heb jij mijn konijntje gezien?" });
  test.throws(/Expected match/, () => test.eq({ text: /Konijntje/ }, { text: "Heb jij mijn konijntje gezien?" }), "We should be case sensitive");
  test.throws(/Expected match/, () => test.eqPartial({ text: /Konijntje/ }, { text: "Heb jij mijn konijntje gezien?" }));
  ///@ts-expect-error -- TS also rejects the regexp on the RHS
  test.throws(/Expected type/, () => test.eq({ text: "Heb jij mijn konijntje gezien?" }, { text: /konijntje/ }), "Only 'expect' is allowed to hold regexes");

  //test comparison callbacks
  test.eq(val => val === "konijntje", "konijntje");
  test.eq([val => val === "konijntje"], ["konijntje"]);
  test.eq({ x: val => val === "konijntje" }, { x: "konijntje" });
  test.eqPartial({ x: val => val === "konijntje" }, { x: "konijntje" });
  test.eq({ x: val => val.y === "konijntje" }, { x: { y: "konijntje" } });
  test.eqPartial({ x: val => val.y === "konijntje" }, { x: { y: "konijntje" } });

  test.throws(/test function failed/, () => test.eq(val => val === "konijntje", "aapje"));
  test.throws(/test function failed/, () => test.eq([val => val === "konijntje"], ["aapje"]));
  test.throws(/test function failed/, () => test.eq({ x: val => val === "konijntje" }, { x: "aapje" }));
  test.throws(/test function failed/, () => test.eqPartial({ x: val => val === "konijntje" }, { x: "aapje" }));

  //test overriding comparison
  test.eq({ x: 4, y: 5 }, { x: 3, y: 5 }, { onCompare: (expect, actual) => expect === 4 && actual === 3 ? true : undefined });
  test.eq({ a: [{ b: 2 }] }, { a: [{ b: 1 }] }, { onCompare: (expect, actual, path) => expect === 2 && actual === 1 ? (test.eq(".a[0].b", path), true) : undefined });
  test.throws(/Custom comparison/, () => test.eq({ x: 4, y: 5 }, { x: 3, y: 5 }, { onCompare: (expect, actual) => expect === 4 && actual === 3 ? false : undefined }));

  const x_ab = { cellA: "A", cellB: "B" };
  const x_abc = { ...x_ab, cellC: "test" };

  //eqPartial replaced eqProps and dropped support for 'ignore'. we can remove these tests once eqProps is gone
  test.eqProps(x_ab, x_ab);
  test.eqProps(x_ab, x_abc);
  test.eqProps(x_abc, x_ab, ["cellC"], "shouldn't throw if cellC is explicitly ignored");
  test.throws(/Expected property 'cellC'.*at root/, () => test.eqProps(x_abc, x_ab));

  const x_abc_badb = { ...x_abc, cellB: "BAD" };
  test.eqProps(x_abc, x_abc_badb, ["cellB"], "shouldn't throw if cellB is explicitly ignored");
  test.throws(/Mismatched value at root.cellB/, () => test.eqProps(x_abc, x_abc_badb));

  ///@ts-expect-error - TS will also complain about the promise
  test.throws(/cannot.*assert.*promise/, () => test.assert(Promise.resolve(true)));

  // test that 'undefined' is also matches missing cells
  {
    const myVar: { a: number; b?: string } = { a: 6, b: "2" };
    const myVarNoB: { a: number; b?: string } = { a: 6 };

    test.eqPartial({ a: 6 }, myVarNoB);
    test.eqPartial({ a: 6, b: undefined }, myVarNoB);
    test.eqPartial({ a: 6, b: undefined }, { a: 6, b: undefined });

    test.throws(/^Expected property 'b', didn't find it, at root$/, () => test.eqPartial({ a: 6, b: "2" }, myVarNoB), "b is missing, so a value should not match it");
    test.throws(/^Mismatched value at root.b/, () => test.eqPartial({ a: 6, b: undefined }, myVar));

    test.eq({ a: 6 }, myVarNoB);
    test.eq({ a: 6, b: undefined }, myVarNoB);

    test.eqPartial({ a: 6 }, myVar);
    test.eqPartial({ a: 6, b: "2" }, myVar);
    test.throws(/Mismatched value at root.b/, () => test.eqPartial({ a: 6, b: undefined }, myVar), "b is present and defined, so undefined should not match it");

    test.throws(/^Key unexpectedly exists: b$/, () => test.eq({ a: 6 }, myVar), "b is present so should be marked as extra property");
    test.eq({ a: 6 }, myVar, {
      onCompare: (expect, actual, path) => {
        if (path === ".b" && expect === undefined && actual === '2')
          return true; //we explicitly accept 'b' unexpectedly present
      }
    });
    test.eq(myVar, { a: 6 }, {
      onCompare: (expect, actual, path) => {
        if (path === ".b" && expect === '2' && actual === undefined)
          return true; //we explicitly accept 'b' missing
      }
    });

    test.throws(/^Expected type: undefined actual type: string at .b$/, () => test.eq({ a: 6, b: undefined }, myVar), "b is set and not undefined, so should be treated as mismatch");
    test.eq({ a: 6, b: "2" }, myVar);

    test.eq({ a: 6, b: "2" }, myVar);
  }

  {
    const readOnlyExpect: { readonly a: ReadonlyArray<{ readonly b: readonly number[] }> } = { a: [{ b: [1] }] };

    test.eq(readOnlyExpect, { a: [{ b: [1] }] });
    test.eqPartial(readOnlyExpect, { a: [{ b: [1] }] });
  }
}

async function ensureWaitAbortable(expectState: string, cb: () => Promise<unknown>) {
  //Allocate new test abort/monitoring infrastructure
  using testMonitor = new TestMonitor();
  test.eq("", testMonitor.waitState());

  const startWait = cb();
  test.eq(expectState, testMonitor.waitState());

  startWait.then(() => { }, () => { });
  testMonitor.abort();

  //Ensure the wait() itself rejected
  test.assert(await startWait.then(() => false, () => true));
  await std.sleep(5); //give all nested promises a chance to complete and clear their wait state
  test.eq("", testMonitor.waitState());
}

async function testTestMonitoring() {
  //wait() has various implementations, test them all
  await ensureWaitAbortable("wait", () => test.wait(() => false));
  await ensureWaitAbortable("wait", () => test.wait(() => true, { test: result => !result }));
  await ensureWaitAbortable("wait", () => test.wait(std.sleep(1000)));
  await ensureWaitAbortable("wait", () => test.wait(() => std.sleep(1000)));

  //this will never resolve:
  await ensureWaitAbortable("wait", () => test.wait(Promise.withResolvers().promise));
  await ensureWaitAbortable("wait", () => test.wait(() => Promise.withResolvers().promise));

  //verify nesting
  await ensureWaitAbortable("wait > wait", () => test.wait(() => test.wait(() => false)));
}

async function testWaits() {
  {
    const start = Date.now();
    await test.throws(/test.wait timed out after 10 ms/, () => test.wait(() => false, { timeout: 10 }));
    const waited = Date.now() - start;
    //it did fail once with 9ms, perhaps some rounding? take 9 to be safe...
    test.assert(waited >= 9, `test.wait didn't wait at least 10ms, but ${waited}ms`);
  }

  {
    const start = Date.now();
    await test.throws(/test.wait timed out after 10 ms/, () => test.wait(new Promise(() => null), { timeout: 10 }));
    const waited = Date.now() - start;
    test.assert(waited >= 9, `test.wait didn't wait at least 10ms, but ${waited}ms`);
  }

  {
    const start = Date.now();
    await test.throws(/test.wait timed out after 10 ms/, () => test.wait(() => Promise.resolve(false), { timeout: 10 }));
    const waited = Date.now() - start;
    test.assert(waited >= 9, `test.wait didn't wait at least 10ms, but ${waited}ms`);
  }

  await test.wait(new Promise(resolve => resolve({ a: 1 })));
  await test.wait(() => Promise.resolve(true));
  await test.throws(/The test option can only be used together with function waits/, () => test.wait(Promise.resolve(true), { test: Boolean }));

  //verify filter is implemented - wait() will not return until n === 6, even though 2 would already be truthy
  let num = 1;
  test.eq(6, await test.wait(() => ++num, { test: n => n >= 6 }));
  //@ts-expect-error -- verifying that we explicitly recognize undefined as false (and noone did a fallback to truthiness of the value).
  test.eq(9, await test.wait(() => ++num, { test: n => n >= 9 || undefined }));
}

async function testLoadTypes() {
  {
    const v_ts = await test.loadTSType(`@mod-webhare_testsuite/tests/system/nodejs/test_tests.ts#MyInterface`);
    test.throws(/data does not conform to the structure: "\/b" must be string/, () => v_ts.validateStructure({ a: 0, b: 1 }), "wrong type not detected");
    test.throws(/must NOT have additional properties/, () => v_ts.validateStructure({ a: 0, b: "a", c: "1" }), "extra property not detected");
    test.throws(/must have required property 'b'/, () => v_ts.validateStructure({ a: 0 }), "missing property not detected");
    v_ts.validateStructure({ a: 0, b: "a" });
  }

  {
    await test.throws(/Could not find export/, test.loadTSType(`@mod-webhare_testsuite/tests/system/nodejs/test_tests.ts#MyPrivateInterface`));
  }

  {
    const v_ts_allow_extra = await test.loadTSType(`@mod-webhare_testsuite/tests/system/nodejs/test_tests.ts#MyInterface`, { noExtraProps: false, required: false });
    v_ts_allow_extra.validateStructure({ a: 0, c: "1" });
  }

  {
    const v_js = await test.loadJSONSchema({ "type": "object", "properties": { "a": { "type": "number" }, "b": { "type": "string" }, "d": { "type": "string", "format": "date-time" } }, "$schema": "http://json-schema.org/draft-07/schema#" });
    v_js.validateStructure({ a: 0, c: "1", d: "2000-01-01T12:34:56Z" });
    test.throws(/data does not conform to the structure: "\/b" must be string/, () => v_js.validateStructure({ a: 0, b: 1 }), "wrong type not detected");
    test.throws(/data does not conform to the structure: "\/d" must match format "date-time"/, () => v_js.validateStructure({ a: 0, d: "test" }), "wrong format not detected");
  }

  {
    const v_jsf = await test.loadJSONSchema("@mod-webhare_testsuite/tests/system/nodejs/data/test.schema.json");
    test.throws(/data does not conform to the structure: "\/b" must be string/, () => v_jsf.validateStructure({ a: 0, b: 1 }), "wrong type not detected");
    test.throws(/must NOT have additional properties/, () => v_jsf.validateStructure({ a: 0, b: "a", c: "1" }), "extra property not detected");
    test.throws(/must have required property 'b'/, () => v_jsf.validateStructure({ a: 0 }), "missing property not detected");
    test.throws(/data does not conform to the structure: "\/d" must match format "date-time"/, () => v_jsf.validateStructure({ a: 0, b: "a", d: "test" }), "wrong format not detected");
    v_jsf.validateStructure({ a: 0, b: "a", d: "2000-01-01T12:34:56Z" });
  }


  {
    test.typeAssert<test.Assignable<number, 2>>();
    // @ts-expect-error -- Can't assign a number to 2
    test.typeAssert<test.Assignable<2, number>>();

    test.typeAssert<test.Extends<2, number>>();
    // @ts-expect-error -- Number doesn't extend 2
    test.typeAssert<test.Extends<number, 2>>();

    test.typeAssert<test.Equals<1, 1>>();
    test.typeAssert<test.Equals<{ a: 1; b: 2 }, { a: 1; b: 2 }>>();

    // @ts-expect-error -- Can't assign a number to 2
    test.typeAssert<test.Equals<number, 1>>();
    // @ts-expect-error -- Can't assign a number to 2
    test.typeAssert<test.Equals<1, number>>();
    // @ts-expect-error -- Can't assign 2 to 1
    test.typeAssert<test.Assignable<1, 2>>();

    // @ts-expect-error -- Can't assign a number to 2
    test.typeAssert<test.Equals<number, 1>>();
    // @ts-expect-error -- Can't assign a number to 2
    test.typeAssert<test.Equals<1, number>>();
    // @ts-expect-error -- Can't assign 2 to 1
    test.typeAssert<test.Assignable<1, 2>>();

  }
}

// Referenced by file#symbol reference in the loadTSType call above
export interface MyInterface {
  a: number;
  b: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- not exported so should not be found
interface MyPrivateInterface {
  a: number;
  b: string;
}

async function runWHTest(testname: string): Promise<string> {
  /* TODO: a much better approach would use child_process.spawn and pipes, merge the stdout&stderr pipe (so there are no ordering issues) and also watch the exit code */
  return new Promise(resolve =>
    child_process.execFile(services.backendConfig.installationRoot + "bin/wh", ["runtest", testname], { timeout: 30000 }, function (error, stdout, stderr) {
      // console.log({error, stdout, stderr});
      resolve(stdout + stderr);
    }));
}

async function checkTestFailures() {
  test.eq(/test\.assert failed.*metatest_shouldfail.ts line 4.*Offending test: test\.assert\(Math\.random\(\) === 42\);/s, await runWHTest("system.nodejs.meta.metatest_shouldfail"));
}

test.runTests([
  testChecks,
  testTestMonitoring,
  testWaits,
  testLoadTypes,
  checkTestFailures
]);
