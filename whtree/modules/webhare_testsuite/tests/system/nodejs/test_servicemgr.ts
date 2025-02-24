/* See servicemanager/main.ts on how to run a separate servicemanager process for faster testing (and as this test creates modules
   I'd also recommend a freshdbconsole or at least an install with a minimal amount of modules) */

import * as test from "@webhare/test";
import { deleteTestModule, installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { openBackendService, backendConfig } from "@webhare/services";
import { type HSVMObject, loadlib } from "@webhare/harescript";
import "@mod-platform/js/services/platformservices"; //to ensure openBackendService can see our service
import { isInvalidWebHareUpgrade } from "@mod-system/js/internal/configuration";

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

  if (backendConfig.module.webhare_testsuite_temp) {
    await deleteTestModule("webhare_testsuite_temp");
    await smservice.reload(); //TODO shouldn't delete testmodule imply this? (but then we still need to at least wait for the service to go away)
  }
}

async function testBasicAPI() {
  //TODO an 'official' API to manage services. perhaps in @webhare/config ? or do you expect this in @webhare/services as it deals with services?
  const smservice = await openBackendService("platform:servicemanager", [], { timeout: 5000 });
  let state = await smservice.getWebHareState();
  test.eq(undefined, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:simpleservice"));

  console.log("installing module");
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
  await deleteTestModule("webhare_testsuite_temp");
  await smservice.reload();

  state = await smservice.getWebHareState();
  console.log(state);
  test.eq(undefined, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:simpleservice"));
}

test.runTests([
  testWebHareUpgrades,
  prepTests,
  testBasicAPI
]);
