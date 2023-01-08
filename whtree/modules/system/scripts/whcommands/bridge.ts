import { program } from 'commander'; //https://www.npmjs.com/package/commander
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { DebugMgrClientLink, DebugMgrClientLinkRequestType, ProcessType } from "@mod-system/js/internal/whmanager/debug";

program
  .name('bridge')

  .description('Control WebHare bridge connections (ie. javascript processes)');

program.command('connections')
  .description('List all scripts connected to the bridge')
  .action(async () => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();
      const res = await link.doRequest({ type: DebugMgrClientLinkRequestType.getProcessList });
      link.close();
      console.table(res.processlist.filter(p => p.type === ProcessType.TypeScript), ["processcode", "name", "pid"]);
    } catch (e) {
      console.error(`Could not connect to debug manager`);
      process.exitCode = 1;
      link.close();
    }
  });

program.command('inspect')
  .description('Enable inspector and return settings')
  .argument('<instance>', 'Instance to connect to')
  .action(async (instance: string) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();

      const searchprocesscode = BigInt(instance);
      const inspectorinfo = await link.doRequest({
        type: DebugMgrClientLinkRequestType.enableInspector,
        processcode: searchprocesscode
      });
      link.close();
      if (inspectorinfo.url) {
        console.log("Inspector URL: " + inspectorinfo.url);
        console.log("Locally you should see the session on chrome://inspect/#devices");
      } else {
        console.log(`Could not enable inspector, process is gone`);
      }
    } catch (e) {
      console.error(`Could not connect to debug manager`);
      process.exitCode = 1;
      link.close();
    }
  });

program.parse();
