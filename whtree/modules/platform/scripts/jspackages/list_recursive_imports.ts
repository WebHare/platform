import { logValidationMessagesToConsole } from "@mod-platform/js/devsupport/messages";
import { checkUsingTSC } from "@mod-platform/js/devsupport/typescript";
import { runCli } from "@webhare/cli";

runCli({
  async main() {
    console.log(`Listing recursive imports for webhare:\n`);

    const issues = await checkUsingTSC("jssdk");
    logValidationMessagesToConsole(issues, { sort: false });
    console.log(`Found ${issues.length} cycles`);
    return issues.length > 0 ? 1 : 0;
  }
});
