import { program } from 'commander'; //https://www.npmjs.com/package/commander
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { DebugMgrClientLink, DebugMgrClientLinkRequestType, ProcessType } from "@mod-system/js/internal/whmanager/debug";

async function getProcessCodeFromInstance(link: DebugMgrClientLink["ConnectEndPoint"], instance: string): Promise<bigint> {
  try {
    return BigInt(instance);
  } catch (e) {
    const res = await link.doRequest({ type: DebugMgrClientLinkRequestType.getProcessList });
    const matches = res.processlist.filter(proc => proc.name.endsWith(instance));
    if (matches.length === 0) {
      throw new Error(`No process matching ${JSON.stringify(instance)}`);
    } else if (matches.length !== 1) {
      throw new Error(`Multiple processes matching ${JSON.stringify(instance)}: ${matches.map(proc => JSON.stringify(proc.name)).join(", ")}`);
    }
    return matches[0].processcode;
  }
}


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
      console.table(res.processlist.filter(p => p.type === ProcessType.TypeScript), ["pid", "name", "processcode"]);
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

      const searchprocesscode = await getProcessCodeFromInstance(link, instance);
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

program.command('getrecentlog')
  .description('Get the last console log items')
  .argument('<instance>', 'Instance to connect to')
  .action(async (instance: string) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();

      const searchprocesscode = await getProcessCodeFromInstance(link, instance);
      const result = await link.doRequest({
        type: DebugMgrClientLinkRequestType.getRecentlyLoggedItems,
        processcode: searchprocesscode
      });
      link.close();
      for (const item of result.items) {
        const printlen = item.data.length - (item.data[item.data.length - 1] == "\n" ? 1 : 0);
        console.log(item.when, item.location ? `${item.location.filename.split('/').reverse()[0] || "unknown"}:${item.location.line}:${item.location.col}` : "unknown:1:1", `${item.data.substring(0, printlen)}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
      link.close();
    }
  });

program.parse();
