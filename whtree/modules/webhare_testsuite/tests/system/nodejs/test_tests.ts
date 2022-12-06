import * as test from '@webhare/test';
import bridge from '@mod-system/js/internal/bridge';

// import * as util from 'node:util';
import * as child_process from 'node:child_process';

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
  test.eqMatch(/testEq fails/, await runWHTest("system.nodejs.meta.metatest_shouldfail") );
}

test.run([ checkTestFailures ]);