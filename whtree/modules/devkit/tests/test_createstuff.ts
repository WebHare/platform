import { createModule } from "@mod-devkit/js/scaffolding/module";
import { backendConfig } from "@webhare/services";
import * as test from "@webhare/test-backend";

const tempModuleName = test.getRandomTestModuleName();

async function testCreateModule() {
  console.log("Creating module", tempModuleName);
  await createModule(test.tempModuleGroup, tempModuleName, { initGit: false, defaultLanguage: "en" });
  console.log("done creating module", tempModuleName);
  test.assert(backendConfig.module[tempModuleName], "Module should be registered in backendConfig");
}

test.run([
  test.reset,
  //creates a basic module
  testCreateModule
]);
