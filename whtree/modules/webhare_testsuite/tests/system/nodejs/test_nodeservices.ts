import * as test from "@webhare/test-backend";
import { installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { openBackendService } from "@webhare/services";
import { generateRandomId } from "@webhare/std";
import "@mod-platform/js/services/platformservices";
import { restartService } from "@mod-platform/js/bootstrap/servicemanager/control";

async function testNewModuleBackendService() {
  const moduleName = `${test.tempModuleNamePrefix}${generateRandomId("hex", 16)}`;

  await installTestModule(moduleName, {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
</module>`,
    "moduledefinition.yml": `
backendServices:
  demoservice:
    onCreateClient: js/demoservice.ts#openDemoService
  instanceservice:
    onCreateController: js/demoservice.ts#createInstanceController
`,
    "js/demoservice.ts": `
import { BackendServiceConnection } from "@webhare/services";
import { generateRandomId } from "@webhare/std";

class DemoService extends BackendServiceConnection {
  ping(value: string) {
    return value;
  }
}

export function openDemoService() {
  return new DemoService;
}

class InstanceService extends BackendServiceConnection {
  constructor(private instanceId: string) {
    super();
  }
  getInstanceId() {
    return this.instanceId;
  }
}

//A controller is created for every launch of the service, so its id tells instances apart
export function createInstanceController() {
  const instanceId = generateRandomId();
  return { createClient: () => new InstanceService(instanceId) };
}
`
  });

  // Newly installed services must be picked up without manually reloading the service runners.
  {
    using service = await openBackendService<{ ping(value: string): string }>(`${moduleName}:demoservice`, [], { timeout: 15_000 });
    test.eq(moduleName, await service.ping(moduleName));
  }

  ////////////////////////////////////////////////////////////////
  // STORY: A restarted service (as done by 'wh service restart') is relaunched and can be used again
  let firstInstanceId: string;
  {
    using service = await openBackendService<{ getInstanceId(): string }>(`${moduleName}:instanceservice`, [], { timeout: 15_000 });
    firstInstanceId = await service.getInstanceId();
  }
  await restartService(`${moduleName}:instanceservice`);
  {
    using service = await openBackendService<{ getInstanceId(): string }>(`${moduleName}:instanceservice`, [], { timeout: 15_000 });
    test.assert(firstInstanceId !== await service.getInstanceId(), "Expected a new instance of the service after the restart");
  }

  await test.deleteTestModule(moduleName);

  for (const protocol of ["bridge", "unix-socket"] as const)
    await test.throws(/Service.*is unavailable/, openBackendService(`${moduleName}:demoservice`, [], { timeout: 500, notOnDemand: true, protocol }));
}

test.runTests([
  testNewModuleBackendService
]);
