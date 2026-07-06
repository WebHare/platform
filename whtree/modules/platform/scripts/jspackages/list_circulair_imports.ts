// @webhare/cli: List circulair imports

import { logValidationMessagesToConsole } from "@mod-platform/js/devsupport/messages";
import { checkUsingTSC } from "@mod-platform/js/devsupport/typescript";
import { runCli } from "@webhare/cli";

const expectNumCycles = 60;

runCli({
  async main() {
    console.log(`Circulair imports for webhare:\n`);

    const issues = await checkUsingTSC("platform");
    logValidationMessagesToConsole(issues, { sort: false });
    if (issues.length < expectNumCycles) {
      console.error(`Expected ${expectNumCycles} cycles, but found ${issues.length}. Update mod::platform/scripts/jspackages/list_circulair_imports.ts to ensure noone else re-adds loops`);
      return 1;
    } else if (issues.length > expectNumCycles) {
      console.error(`Expected ${expectNumCycles} cycles, but found ${issues.length}. Fix your commit, we don't want to ADD more loops!`);
      return 1;
    } else {
      console.log(`Found ${issues.length} cycles as expected`);
      return 0;
    }
  }
});
