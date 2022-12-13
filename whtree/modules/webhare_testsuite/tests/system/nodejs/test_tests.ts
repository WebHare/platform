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
  await test.throws(/Mismatched value at root.cellB/, () => test.eqProps(x_abc, x_abc_badb ));
}

async function runWHTest(testname: string) : Promise<string> {
  await bridge.ready;

  /* TODO: a much better approach would use child_process.spawn and pipes, merge the stdout&stderr pipe (so there are no ordering issues) and also watch the exit code */
  return new Promise(resolve =>
    child_process.execFile(bridge.getInstallationRoot() + "bin/wh", [ "runtest", testname ], { timeout: 30000 }, function (error, stdout, stderr) {
      // console.log({error, stdout, stderr});
      resolve( stdout + stderr );
    }));
}

async function checkTestFailures() {
  test.eqMatch(/test\.assert failed.*metatest_shouldfail.ts line 4.*Offending test: test\.assert\(Math\.random\(\) === 42\);/s, await runWHTest("system.nodejs.meta.metatest_shouldfail") );
}

test.run([ testChecks
         , checkTestFailures
         ]);
