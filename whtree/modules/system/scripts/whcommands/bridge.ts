import { program } from 'commander'; //https://www.npmjs.com/package/commander
import bridge from "@mod-system/js/internal/whmanager/bridge";
import { type DebugMgrClientLink, DebugMgrClientLinkRequestType } from "@mod-system/js/internal/whmanager/debug";
import { WHMProcessType } from '@mod-system/js/internal/whmanager/whmanager_rpcdefs';
import * as child_process from "node:child_process";

/// short: Control WebHare bridge connections (ie. javascript processes)

program
  .name('bridge')

  .description('Control WebHare bridge connections (ie. javascript processes)');

program.command('connections')
  .description('List all scripts connected to the bridge')
  .option('--json', 'output as JSON')
  .action(async (options) => {

    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    let result;

    try {
      await link.activate();
      result = await link.doRequest({ type: DebugMgrClientLinkRequestType.getProcessList });
    } catch (e) {
      console.error(`Could not connect to debug manager`);
      process.exitCode = 1;
      return;
    } finally {
      link.close();
    }

    const list = result.processlist.filter(p => p.type === WHMProcessType.TypeScript);
    if (options.json)
      console.log(JSON.stringify(list));
    else
      console.table(list, ["pid", "name"]);
  });

async function getInspectorURL(process: string) {
  const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
  try {
    await link.activate();
    const inspectorinfo = await link.doRequest({
      type: DebugMgrClientLinkRequestType.enableInspector,
      processid: process
    });
    return inspectorinfo?.url || null;
  } catch (e) {
    console.error(`Could not connect to debug manager`);
    return null;
  } finally {
    link.close();
  }
}

program.command('getenvironment')
  .description('Get process environment')
  .argument('<process>', 'Process to connect to')
  .action(async (instance: string) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();

      const result = await link.doRequest({
        type: DebugMgrClientLinkRequestType.getEnvironment,
        processid: instance
      });
      link.close();
      console.log(JSON.stringify(result.env, null, 2));
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
      link.close();
    }
  });

program.command('inspect')
  .description('Enable inspector and return settings')
  .argument('<process>', 'Process to connect to')
  .action(async (instance: string) => {
    const url = await getInspectorURL(instance);
    if (url) {
      console.log("Inspector URL: " + url);
      console.log("Locally you should see the session on chrome://inspect/#devices");
    } else {
      console.error("Could not enable inspector");
      process.exitCode = 1;
    }
  });

program.command('inspect-in-chrome')
  .description('Inspect the process in Chrome devtools')
  .argument('<process>', 'Process to connect to')
  .action(async (instance: string) => {
    const url = await getInspectorURL(instance);
    if (url) {
      const devtoolsurl = `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${encodeURIComponent(url.substring(5))}`;
      console.log("Opening " + devtoolsurl);
      const subprocess = child_process.spawn("/usr/bin/open", ["-a", "/Applications/Google Chrome.app", devtoolsurl], { detached: true, stdio: ['inherit', 'inherit', 'inherit'] });
      subprocess.unref();
    } else {
      console.error("Could not enable inspector");
      process.exitCode = 1;
    }
  });

program.command('getrecentlog')
  .description('Get the last console log items')
  .argument('<instance>', 'Instance to connect to')
  .action(async (instance: string) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();

      const result = await link.doRequest({
        type: DebugMgrClientLinkRequestType.getRecentlyLoggedItems,
        processid: instance
      });
      link.close();
      for (const item of result.items) {
        const printlen = item.data.length - (item.data[item.data.length - 1] === "\n" ? 1 : 0);
        console.log(item.when, item.location ? `${item.location.filename.split('/').reverse()[0] || "unknown"}:${item.location.line}:${item.location.col}` : "unknown:1:1", `${item.data.substring(0, printlen)}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
      link.close();
    }
  });

program.command('gethmrstate')
  .description('Get the HMR state')
  .argument('<instance>', 'Instance to connect to')
  .action(async (instance: string) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();

      const result = await link.doRequest({
        type: DebugMgrClientLinkRequestType.getHMRState,
        processid: instance
      });
      link.close();
      console.log(JSON.stringify(result));
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
      link.close();
    }
  });

program.command('getcodecontexts')
  .description('Get the currently active code contexts')
  .argument('<instance>', 'Instance to connect to')
  .action(async (instance: string) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();

      const result = await link.doRequest({
        type: DebugMgrClientLinkRequestType.getCodeContexts,
        processid: instance
      });
      link.close();
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
      link.close();
    }
  });

program.command('getworkers')
  .description('Get the currently active workers of an instance')
  .argument('<instance>', 'Instance to connect to')
  .action(async (instance: string) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();

      const result = await link.doRequest({
        type: DebugMgrClientLinkRequestType.getWorkers,
        processid: instance
      });
      link.close();
      console.log(JSON.stringify(result.workers, null, 2));
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
      link.close();
    }
  });

program.command('findworker')
  .description('Find matching workers')
  .option('--json', 'output as JSON')
  .argument('<instance>', 'Instance to connect to')
  .action(async (workerid: string, options) => {
    const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
    try {
      await link.activate();
      const processlistresponse = (await link.doRequest({ type: DebugMgrClientLinkRequestType.getProcessList }));
      const processes = processlistresponse.processlist.filter(p => p.type === WHMProcessType.TypeScript);

      const processwithworkers = await Promise.all(processes.map(async (p) => {
        try {
          const workerresponse = await link.doRequest({ type: DebugMgrClientLinkRequestType.getWorkers, processid: String(p.pid) + '.0' }, { signal: AbortSignal.timeout(1000) });
          const matchingworkers = workerresponse.workers.filter(w => w.workerid.startsWith(workerid));//.map(w => w.id).join(", ");
          return { ...p, matchingworkers };
        } catch (e) {
          return { ...p, matchingworkers: [] };
        }
      }));

      const list = processwithworkers.filter(p => p.matchingworkers.length);
      if (options.json)
        console.log(JSON.stringify(list));
      else {
        if (list.length)
          console.table(list.map(l => ({ ...l, matchingworkers: l.matchingworkers.map(w => w.workerid).join(", ") })), ["pid", "name", "processcode", "matchingworkers"]);
        else
          console.log(`No workers found with an id starting with ${JSON.stringify(workerid)}`);
      }
    } catch (e) {
      console.error(`Error: ${(e as Error).message}`);
      process.exitCode = 1;
      return;
    } finally {
      link.close();
    }
  });

program.parse();
