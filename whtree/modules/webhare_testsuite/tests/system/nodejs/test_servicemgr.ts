/* See servicemanager/main.ts on how to run a separate servicemanager process for faster testing (and as this test creates modules
   I'd also recommend a freshdbconsole or at least an install with a minimal amount of modules) */

import * as test from "@webhare/test-backend";
import { installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { openBackendService, toFSPath } from "@webhare/services";
import { type HSVMObject, loadlib } from "@webhare/harescript";
import "@mod-platform/js/services/platformservices"; //to ensure openBackendService can see our service
import { isInvalidWebHareUpgrade } from "@mod-system/js/internal/configuration";
import { getWebHareServiceState, restartService } from '@mod-platform/js/bootstrap/servicemanager/control';
import { generateRandomId } from "@webhare/std/src/platformbased";
import { readFile } from "node:fs/promises";

async function testWebHareUpgrades() {
  test.assert(!isInvalidWebHareUpgrade("5.0.2-dev", "5.0.2-dev"), "Comparing identical versions should be fine");
  test.assert(isInvalidWebHareUpgrade("5.0.2", "5.0.1"), "Downgrade from 5.0.2 to 5.0.1 should not have been accepted");
  test.assert(!isInvalidWebHareUpgrade("5.0.2-dev", "5.0.2"), "Accept going from -dev to real version");
  test.assert(!isInvalidWebHareUpgrade("5.0.1-dev", "5.0.2"), "Accept going from previous -dev to a real version");
  test.assert(!isInvalidWebHareUpgrade("4.35.0", "5.0.0-dev"), "Accept major update");
  test.assert(isInvalidWebHareUpgrade("5.0.3-dev", "5.0.2"), "Should not allow you to downgrade from -dev back to the previous prod version");
  test.assert(isInvalidWebHareUpgrade("5.0.3", "5.0.3-dev"), "Should not allow you to downgrade back to -dev");

  test.assert(isInvalidWebHareUpgrade("4.34.0", "5.0.0"), "Should not allow you to upgrade from 4.34 straight to 5.0");
  test.assert(isInvalidWebHareUpgrade("4.34.0", "5.0.0-dev"), "Should not allow you to upgrade from 4.34 straight to 5.0");
  test.assert(isInvalidWebHareUpgrade("4.34.99", "5.0.0-dev"), "Should not allow you to upgrade from 4.34 straight to 5.0");
  test.assert(isInvalidWebHareUpgrade("4.35.0-dev", "5.0.0-dev"), "Should not allow you to upgrade from 4.35 dangerous prereleases straight to 5.0");

  test.assert(isInvalidWebHareUpgrade("5.1.0-dev", "5.1.0-custom-5.1"), "Same base version, but dev > custom, so unacceptable");
  test.assert(!isInvalidWebHareUpgrade("5.1.0-dev", "5.1.1-custom-5.1"), "A 'sideways' upgrade to newer is acceptable");
  test.assert(isInvalidWebHareUpgrade("5.1.1-dev", "5.1.0-custom-5.1"), "A 'sideways' upgrade to older is unacceptable");

  test.assert(isInvalidWebHareUpgrade("5.1.0-dev", "5.1.0-5-1-certbotupdates"), "Don't get confused by the many numbers added by a custom/5-1-certbotupdates branch #1 - semver wise this is invalid (ASCII: d < 5)");
  test.assert(!isInvalidWebHareUpgrade("5.1.0-5-1-certbotupdates", "5.1.0-dev"), "Don't get confused by the many numbers added by a custom/5-1-certbotupdates branch #2 - semver wise this is valid (ASCII: d > c)");
}

async function prepTests() {
  const smservice = await openBackendService("platform:servicemanager", [], { timeout: 5000 });
  const state = await smservice.getWebHareState();
  test.eq("Online", state.stage, "By the time tests run, it should be Online");
}

async function testBasicAPI() {
  //TODO an 'official' API to manage services. perhaps in @webhare/config ? or do you expect this in @webhare/services as it deals with services?
  const smservice = await openBackendService("platform:servicemanager", [], { timeout: 5000 });
  let state = await smservice.getWebHareState();
  test.eq(undefined, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:simpleservice"));

  await installTestModule("webhare_testsuite_temp", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.2</version>
  </meta>
</module>`,
    "moduledefinition.yml": `
managedServices:
  simpleservice:
    script: js/service.js
    arguments: ["webhare_testsuite_temp:simple"]
    run: always
  ondemandservice:
    script: js/service.js
    arguments: ["webhare_testsuite_temp:ondemandservice"]
    run: on-demand # should autostart as soon as someone connects to the backend service
  ondemandservice2:
    script: js/service.js
    arguments: ["webhare_testsuite_temp:ondemandservice2"]
    run: on-demand # should autostart as soon as someone connects to the backend service
`,
    "js/service.js": `
const { runBackendService, BackendServiceConnection } = require('@webhare/services');
const instanceid = "instance" + Math.random();
const port = process.argv[2];
let service;
class Client extends BackendServiceConnection {
  info() { return { x: 42, instanceid, port }; }
  shutdown() { service.close(); }
};
console.log("Creating a backendService listening on", port);
service = runBackendService(port, () => new Client);`
  });


  console.log("reloading settings");
  await smservice.reload();

  state = await smservice.getWebHareState();
  const myservice = state.availableServices.find(_ => _.name === "webhare_testsuite_temp:simpleservice");
  test.eqPartial({ isRunning: true }, myservice);

  const ondemandservice = state.availableServices.find(_ => _.name === "webhare_testsuite_temp:ondemandservice");
  test.eqPartial({ isRunning: false }, ondemandservice);

  //Connect to our new services
  const testclient = await openBackendService<any>("webhare_testsuite_temp:simple", []);
  test.eqPartial({ x: 42 }, await testclient.info());
  testclient.close();

  console.log("Connecting to on demand service");
  const testondemand = await openBackendService<any>("webhare_testsuite_temp:ondemandservice", []);
  const instanceid = (await testondemand.info()).instanceid;

  //Tell the service to shut down
  console.log("Manually stopping on demand service");
  await smservice.stopService("webhare_testsuite_temp:ondemandservice");
  await test.throws(/is unavailable/, openBackendService<any>("webhare_testsuite_temp:ondemandservice", [], { timeout: 500, notOnDemand: true }));

  state = await smservice.getWebHareState();
  test.eqPartial({ isRunning: false }, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:ondemandservice"));

  const testondemand_reconect = await openBackendService<any>("webhare_testsuite_temp:ondemandservice", []);
  test.assert(instanceid !== (await testondemand_reconect.info()).instanceid);

  state = await smservice.getWebHareState();
  test.eqPartial({ isRunning: true }, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:ondemandservice"));

  //Have HareScript connect to an ondemand service
  const ondemandThroughHS = await loadlib("mod::system/lib/services.whlib").openWebHareService("webhare_testsuite_temp:ondemandservice2") as HSVMObject;
  test.eqPartial({ x: 42, port: "webhare_testsuite_temp:ondemandservice2" }, await ondemandThroughHS.info());
  test.assert(instanceid !== (await ondemandThroughHS.info()).instanceid);

  //Delete the module again
  await test.deleteTestModule("webhare_testsuite_temp");

  state = await smservice.getWebHareState();
  console.log(state);
  test.eq(undefined, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:simpleservice"));
}

async function testThrottledRestart() {
  using smservice = await openBackendService("platform:servicemanager", [], { timeout: 5000 });
  const serviceName = "webhare_testsuite_temp:throttled";
  await installTestModule("webhare_testsuite_temp", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
</module>`,
    "moduledefinition.yml": `
managedServices:
  throttled:
    script: js/service.js
    run: always
    maxThrottleMsecs: 1000
`,
    "js/service.js": `setInterval(() => {}, 1000);`
  });

  try {
    await smservice.reload();
    const initial = await test.wait(async () => {
      const state = await smservice.getWebHareState();
      return state.availableServices.find(service => service.name === serviceName && service.isRunning);
    });
    process.kill(initial.pid, "SIGTERM");

    await test.wait(async () => {
      const state = await smservice.getWebHareState();
      return state.availableServices.some(service => service.name === serviceName && !service.isRunning && service.pid === 0);
    });

    await restartService(serviceName);
    const restarted = await test.wait(async () => {
      const state = await smservice.getWebHareState();
      return state.availableServices.find(service => service.name === serviceName && service.isRunning);
    });

    // Let the original throttle deadline pass so an uncancelled timer would have fired.
    await test.sleep(1500);
    let state = await smservice.getWebHareState();
    test.eqPartial({ pid: restarted.pid, isRunning: true }, state.availableServices.find(service => service.name === serviceName));

    test.eqPartial({ ok: true }, await smservice.stopService(serviceName));
    state = await smservice.getWebHareState();
    test.eqPartial({ pid: 0, isRunning: false }, state.availableServices.find(service => service.name === serviceName));

    // Stopping a throttled start must also leave the service available for an explicit start.
    test.eqPartial({ ok: true }, await smservice.startService(serviceName));
    const running = await test.wait(async () => {
      const current = await smservice.getWebHareState();
      return current.availableServices.find(service => service.name === serviceName && service.isRunning);
    });
    process.kill(running.pid, "SIGTERM");
    await test.wait(async () => {
      const current = await smservice.getWebHareState();
      return current.availableServices.some(service => service.name === serviceName && !service.isRunning && service.pid === 0);
    });
    test.eqPartial({ ok: true }, await smservice.stopService(serviceName));
    await test.sleep(1500);
    test.eqPartial({ ok: true }, await smservice.startService(serviceName));
  } finally {
    await test.deleteTestModule("webhare_testsuite_temp");
  }
}

async function testNewModuleBackendService() {
  const moduleName = `${test.tempModuleNamePrefix}${generateRandomId("hex", 16)}`;
  const managedService = `${moduleName}:slowstop`;

  await installTestModule(moduleName, {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
</module>`,
    "moduledefinition.yml": `
managedServices:
  slowstop:
    script: js/slowstop.js
    run: always
`,
    "js/slowstop.js": `
require("node:fs").appendFileSync(require("node:path").join(__dirname, "starts.txt"), process.pid + "\\n");
setInterval(() => {}, 1000);
process.once("SIGTERM", () => {
  console.log("Stopping slowstop");
  setTimeout(() => process.exit(0), 2000);
});
console.log("Ready slowstop");
`
  });

  // Regression: overlapping restarts used to await the same process exit and each spawn a replacement.
  // The duplicate instance could survive service shutdown; duplicate registration must now be rejected.
  // The delayed SIGTERM handler lets a second client request a restart while the first is still stopping.
  const initial = await test.wait(async () => {
    const state = await getWebHareServiceState();
    return state.availableServices.find(service => service.name === managedService && service.lastLogText === "Ready slowstop");
  });

  const firstRestart = restartService(managedService);
  await test.wait(async () => {
    const state = await getWebHareServiceState();
    return state.availableServices.some(service => service.name === managedService && service.lastLogText === "Stopping slowstop");
  });

  await Promise.all([firstRestart, restartService(managedService)]);

  const restarted = await test.wait(async () => {
    const state = await getWebHareServiceState();
    return state.availableServices.find(service => service.name === managedService && service.lastLogText === "Ready slowstop");
  });
  test.assert(initial.pid !== restarted.pid);
  test.eq([initial.pid, restarted.pid],
    (await readFile(toFSPath(`mod::${moduleName}/js/starts.txt`), "utf8")).trim().split("\n").map(Number),
    "Concurrent restarts must start exactly one replacement");

  await test.deleteTestModule(moduleName);

  for (const protocol of ["bridge", "unix-socket"] as const)
    await test.throws(/Service.*is unavailable/, openBackendService(`${moduleName}:demoservice`, [], { timeout: 500, notOnDemand: true, protocol }));
}

test.runTests([
  testWebHareUpgrades,
  prepTests,
  testThrottledRestart,
  testBasicAPI,
  testNewModuleBackendService,
]);
