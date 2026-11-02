import * as test from "@webhare/test-backend";
import { installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { openBackendService } from "@webhare/services";
import { generateRandomId } from "@webhare/std";
import "@mod-platform/js/services/platformservices";

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
`,
    "js/demoservice.ts": `
import { BackendServiceConnection } from "@webhare/services";

class DemoService extends BackendServiceConnection {
  ping(value: string) {
    return value;
  }
}

export function openDemoService() {
  return new DemoService;
}
`
  });

  // Newly installed services must be picked up without manually reloading the service runners.
  {
    using service = await openBackendService<{ ping(value: string): string }>(`${moduleName}:demoservice`, [], { timeout: 15_000 });
    test.eq(moduleName, await service.ping(moduleName));
  }

  await test.deleteTestModule(moduleName);

  for (const protocol of ["bridge", "unix-socket"] as const)
    await test.throws(/Service.*is unavailable/, openBackendService(`${moduleName}:demoservice`, [], { timeout: 500, notOnDemand: true, protocol }));
}

test.runTests([
  testNewModuleBackendService
]);
