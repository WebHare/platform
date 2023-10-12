import { openBackendService } from "@webhare/services/src/backendservice";
import { type ServiceManagerClient } from "@mod-platform/js/bootstrap/servicemanager";
import * as test from "@webhare/test";
import { deleteTestModule, installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { backendConfig } from "@webhare/services/src/services";

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
    script: js/simpleservice.js
`,
    "js/simpleservice.js": `
import runBackendService from '@mod-system/js/internal/webhareservice';

class Client {
  hey() { return 42; }
};
console.log("Starting js/simpleservice.js");
runBackendService("webhare_testsuite_temp:simple", () => new Client);`
  });


  console.log("reloading settings");
  await smservice.reload();

  state = await smservice.getWebHareState();
  const myservice = state.availableServices.find(_ => _.name === "webhare_testsuite_temp:simpleservice");
  test.assert(myservice);

  //Connect to our new service
  const testclient = await openBackendService<any>("webhare_testsuite_temp:simple", []);
  test.eq(42, await testclient.hey());
  testclient.close();

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
