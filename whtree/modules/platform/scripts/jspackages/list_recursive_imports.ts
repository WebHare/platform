import { logValidationMessagesToConsole } from "@mod-platform/js/devsupport/messages";
import { checkUsingTSC } from "@mod-platform/js/devsupport/typescript";
import { run } from "@webhare/cli";

run({
  async main() {
    console.log(`Listing recursive imports for webhare:\n`);

    const issues = await checkUsingTSC("jssdk");
    logValidationMessagesToConsole(issues);
    console.log(`Found ${issues.length} cycles`);
    return issues.length > 0 ? 1 : 0;
  }
});
