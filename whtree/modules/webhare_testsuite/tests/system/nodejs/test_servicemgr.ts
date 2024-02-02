/* See servicemanager/main.ts on how to run a separate servicemanager process for faster testing (and as this test creates modules
   I'd also recommend a freshdbconsole or at least an install with a minimal amount of modules) */

import { type ServiceManagerClient } from "@mod-platform/js/bootstrap/servicemanager/main";
import * as test from "@webhare/test";
import { deleteTestModule, installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { openBackendService, backendConfig } from "@webhare/services";
import { HSVMObject, loadlib } from "@webhare/harescript";

async function prepTests() {
  const smservice = await openBackendService<ServiceManagerClient>("platform:servicemanager", [], { timeout: 5000 });
  const state = await smservice.getWebHareState();
  test.eq("Online", state.stage, "By the time tests run, it should be Online");

  if (backendConfig.module.webhare_testsuite_temp) {
    await deleteTestModule("webhare_testsuite_temp");
    await smservice.reload(); //TODO shouldn't delete testmodule imply this? (but then we still need to at least wait for the service to go away)
  }
}

async function testBasicAPI() {
  //TODO an 'official' API to manage services. perhaps in @webhare/config ? or do you expect this in @webhare/services as it deals with services?
  const smservice = await openBackendService<ServiceManagerClient>("platform:servicemanager", [], { timeout: 5000 });
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
import { runBackendService } from '@webhare/services';
const instanceid = "instance" + Math.random();
const port = process.argv[2];
let service;
class Client {
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
  test.eqProps({ isRunning: true }, myservice);

  const ondemandservice = state.availableServices.find(_ => _.name === "webhare_testsuite_temp:ondemandservice");
  test.eqProps({ isRunning: false }, ondemandservice);

  //Connect to our new services
  const testclient = await openBackendService<any>("webhare_testsuite_temp:simple", []);
  test.eqProps({ x: 42 }, await testclient.info());
  testclient.close();

  console.log("Connecting to on demand service");
  const testondemand = await openBackendService<any>("webhare_testsuite_temp:ondemandservice", []);
  const instanceid = (await testondemand.info()).instanceid;

  //Tell the service to shut down
  console.log("Manually stopping on demand service");
  await smservice.stopService("webhare_testsuite_temp:ondemandservice");
  await test.throws(/is unavailable/, openBackendService<any>("webhare_testsuite_temp:ondemandservice", [], { timeout: 500, notOnDemand: true }));

  state = await smservice.getWebHareState();
  test.eqProps({ isRunning: false }, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:ondemandservice"));

  const testondemand_reconect = await openBackendService<any>("webhare_testsuite_temp:ondemandservice", []);
  test.assert(instanceid != (await testondemand_reconect.info()).instanceid);

  state = await smservice.getWebHareState();
  test.eqProps({ isRunning: true }, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:ondemandservice"));

  //Have HareScript connect to an ondemand service
  const ondemandThroughHS = await loadlib("mod::system/lib/services.whlib").openWebHareService("webhare_testsuite_temp:ondemandservice2") as HSVMObject;
  test.eqProps({ x: 42, port: "webhare_testsuite_temp:ondemandservice2" }, await ondemandThroughHS.info());
  test.assert(instanceid != (await ondemandThroughHS.info()).instanceid);

  //Delete the module again
  await deleteTestModule("webhare_testsuite_temp");
  await smservice.reload();

  state = await smservice.getWebHareState();
  console.log(state);
  test.eq(undefined, state.availableServices.find(_ => _.name === "webhare_testsuite_temp:simpleservice"));
}

test.run([
  prepTests,
  testBasicAPI
]);
