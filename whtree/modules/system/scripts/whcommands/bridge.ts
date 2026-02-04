// @webhare/cli: Control WebHare bridge connections (ie. javascript processes)

// TODO move/integrate this into `wh debug`, reconsider command names then (and add dashes)

import bridge from "@mod-system/js/internal/whmanager/bridge";
import { type DebugMgrClientLink, DebugMgrClientLinkRequestType } from "@mod-system/js/internal/whmanager/debug";
import { WHMProcessType } from '@mod-system/js/internal/whmanager/whmanager_rpcdefs';
import * as child_process from "node:child_process";
import { CLIRuntimeError, CLISyntaxError, run } from "@webhare/cli";
import { getInspectorURL, listLocks } from "@mod-platform/js/bridge/tools";
import { devtoolsProxy } from "@mod-platform/js/bridge/devtools-proxy";
import { getCachePathForFile } from "@webhare/tsrun/src/resolvehook";
import { throwError } from "@webhare/std";

function parseHostPort(str: string) {
  const matchRes = str.match(/^(([0-9.]+):)?([0-9]+)$/);
  if (!matchRes)
    throw new CLISyntaxError(`Could not parse host/port from ${JSON.stringify(str)}`);

  return { host: matchRes[2] || null, port: parseInt(matchRes[3]) };
}

run({
  subCommands:
  {
    "connections": {
      description: "List all scripts connected to the bridge",
      flags: {
        "j,json": { description: "Output in JSON format" }
      },
      main: async ({ opts }) => {
        const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        let result;

        try {
          await link.activate();
          result = await link.doRequest({ type: DebugMgrClientLinkRequestType.getProcessList });
        } catch (e) {
          throw new CLIRuntimeError(`Could not connect to debug manager`);
        } finally {
          link.close();
        }

        const list = result.processlist.filter(p => p.type === WHMProcessType.TypeScript);
        if (opts.json)
          console.log(JSON.stringify(list));
        else
          console.table(list, ["pid", "name"]);
      }
    }, "getenvironment": {
      description: "Get process environment",
      arguments: [{ name: "<process>", description: "Process to connect to" }],
      main: async ({ args }) => {
        const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        try {
          await link.activate();

          const result = await link.doRequest({
            type: DebugMgrClientLinkRequestType.getEnvironment,
            processid: args.process
          });
          link.close();
          console.log(JSON.stringify(result.env, null, 2));
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exitCode = 1;
          link.close();
        }
      }
    },
    "inspect": {
      description: "Enable inspector and return settings",
      arguments: [{ name: "<process>", description: "Process to connect to" }],
      main: async ({ args }) => {
        const url = await getInspectorURL(args.process);
        console.log("Inspector URL: " + url);
        console.log("Locally you should see the session on chrome://inspect/#devices");
      }
    },
    "inspect-in-chrome": {
      description: "Inspect the process in Chrome devtools",
      arguments: [{ name: "<process>", description: "Process to connect to" }],
      main: async ({ args }) => {
        const url = await getInspectorURL(args.process);
        const devtoolsurl = `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${encodeURIComponent(url.substring(5))}`;
        console.log("Opening " + devtoolsurl);
        const subprocess = child_process.spawn("/usr/bin/open", ["-a", "/Applications/Google Chrome.app", devtoolsurl], { detached: true, stdio: ['inherit', 'inherit', 'inherit'] });
        subprocess.unref();
      }
    },
    "devtools-proxy": {
      description: "Start a DevTools proxy for the given process",
      options: {
        bind: { description: "Address to bind the proxy to", default: "127.0.0.1:9229" },
        local: { description: "Local port" }
      },
      arguments: [{ name: "<process>", description: "Process to connect to" }],
      main: async ({ opts, args }) => {

        const parsedBind = parseHostPort(opts.bind);
        const bindHost = parsedBind.host || "127.0.0.1";
        const bindPort = parsedBind.port;

        const parsedLocal = parseHostPort(opts.local || `${bindHost}:${bindPort}`);
        const localHost = parsedLocal.host || "127.0.0.1";
        const localPort = parsedLocal.port;

        await devtoolsProxy({ localHost, localPort, bindHost, bindPort, connectProcess: args.process });
      }
    },
    "getrecentlog": {
      description: "Get the last console log items",
      arguments: [{ name: "<instance>", description: "Instance to connect to" }],
      main: async ({ args }) => {
        const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        try {
          await link.activate();

          const result = await link.doRequest({
            type: DebugMgrClientLinkRequestType.getRecentlyLoggedItems,
            processid: args.instance
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
      }
    },
    "gethmrstate": {
      description: "Get the HMR state",
      arguments: [{ name: "<instance>", description: "Instance to connect to" }],
      main: async ({ args }) => {
        const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        try {
          await link.activate();

          const result = await link.doRequest({
            type: DebugMgrClientLinkRequestType.getHMRState,
            processid: args.instance
          });
          link.close();
          console.log(JSON.stringify(result));
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exitCode = 1;
          link.close();
        }
      }
    },
    "getcodecontexts": {
      description: "Get the currently active code contexts",
      arguments: [{ name: "<instance>", description: "Instance to connect to" }],
      main: async ({ args }) => {
        const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        try {
          await link.activate();

          const result = await link.doRequest({
            type: DebugMgrClientLinkRequestType.getCodeContexts,
            processid: args.instance
          });
          link.close();
          console.log(JSON.stringify(result, null, 2));
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exitCode = 1;
          link.close();
        }
      }
    },
    "getworkers": {
      description: "Get the currently active workers of an instance",
      arguments: [{ name: "<instance>", description: "Instance to connect to" }],
      main: async ({ args }) => {
        const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        try {
          await link.activate();

          const result = await link.doRequest({
            type: DebugMgrClientLinkRequestType.getWorkers,
            processid: args.instance
          });
          link.close();
          console.log(JSON.stringify(result.workers, null, 2));
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exitCode = 1;
          link.close();
        }
      }
    },
    "get-compiled-version": {
      description: "Get the compiled version of a script",
      arguments: [{ name: "<scriptpath>", description: "Path to the script" }],
      main: async ({ args }) => {
        console.log(getCachePathForFile(process.env.WEBHARE_TSBUILDCACHE || throwError("No WEBHARE_TSBUILDCACHE environment variable set"), args.scriptpath));
      }
    },
    "get-locks": {
      description: "Get current mutex locks",
      main: async () => {
        console.log(await listLocks());
      }
    },
    "findworker": {
      description: "Find matching workers",
      flags: {
        "j,json": { description: "Output in JSON format" }
      },
      arguments: [{ name: "<instance>", description: "Instance to connect to" }],
      main: async ({ args, opts }) => {
        const link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        try {
          await link.activate();
          const processlistresponse = (await link.doRequest({ type: DebugMgrClientLinkRequestType.getProcessList }));
          const processes = processlistresponse.processlist.filter(p => p.type === WHMProcessType.TypeScript);

          const processwithworkers = await Promise.all(processes.map(async (p) => {
            try {
              const workerresponse = await link.doRequest({ type: DebugMgrClientLinkRequestType.getWorkers, processid: String(p.pid) + '.0' }, { signal: AbortSignal.timeout(1000) });
              const matchingworkers = workerresponse.workers.filter(w => w.workerid.startsWith(args.instance));//.map(w => w.id).join(", ");
              return { ...p, matchingworkers };
            } catch (e) {
              return { ...p, matchingworkers: [] };
            }
          }));

          const list = processwithworkers.filter(p => p.matchingworkers.length);
          if (opts.json)
            console.log(JSON.stringify(list));
          else {
            if (list.length)
              console.table(list.map(l => ({ ...l, matchingworkers: l.matchingworkers.map(w => w.workerid).join(", ") })), ["pid", "name", "processcode", "matchingworkers"]);
            else
              console.log(`No workers found with an id starting with ${JSON.stringify(args.instance)}`);
          }
        } catch (e) {
          console.error(`Error: ${(e as Error).message}`);
          process.exitCode = 1;
          return;
        } finally {
          link.close();
        }
      }
    }
  }
});
