import * as test from "@webhare/test-backend";
import { installTestModule } from "@mod-webhare_testsuite/js/config/testhelpers";
import { beginWork, commitWork } from "@webhare/whdb";
import { deleteRegistryKey, readRegistryKey, writeRegistryKey } from "@webhare/services";

async function testPostStartScripts() {
  await beginWork();
  await writeRegistryKey("webhare_testsuite:tests.response", "");
  await deleteRegistryKey("system:servicemanager.runonce.webhare_testsuite_moduletest:poststart_task", { acceptInvalidKeyNames: true });
  await commitWork();

  await installTestModule("webhare_testsuite_moduletest", {
    "moduledefinition.xml": `<?xml version="1.0"?>
<module xmlns="http://www.webhare.net/xmlns/system/moduledefinition">
  <meta>
    <version>0.0.1</version>
  </meta>
  <servicemanager>
    <runonce script="scripts/runonce/poststart_task.ts" tag="poststart_task" when="poststart" />
  </servicemanager>
</module>`,
    "scripts/runonce/poststart_task.ts": `
import { beginWork, commitWork } from "@webhare/whdb";
import { writeRegistryKey } from "@webhare/services";

async function writeKey() {
  console.log("running webhare_testsuite_moduletest poststart script");
  await beginWork();
  await writeRegistryKey("webhare_testsuite:tests.response", "poststart script ran");
  await commitWork();
}
void writeKey();
`,
  });

  await test.wait(async () => await readRegistryKey("webhare_testsuite:tests.response") === "poststart script ran");
}


test.runTests([
  test.reset,
  testPostStartScripts,
]);
