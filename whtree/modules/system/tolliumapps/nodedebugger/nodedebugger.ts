import bridge from "@mod-system/js/internal/whmanager/bridge";
import { type DebugMgrClientLink, DebugMgrClientLinkRequestType, DebugMgrClientLinkResponseType } from "@mod-system/js/internal/whmanager/debug";
import { getTypedArray } from "@mod-system/js/internal/whmanager/hsmarshalling";
import { sleep } from "@mod-system/js/wh/testframework";
import { HSVMMarshallableOpaqueObject, type HSVMObject } from "@webhare/harescript/src/wasm-proxies";
import { defaultDateTime } from "@webhare/hscompat";
import { HareScriptType } from "@webhare/hscompat/src/hson";
import { logError, toResourcePath } from "@webhare/services";


class NodeDebuggerApp extends HSVMMarshallableOpaqueObject {
  screen: HSVMObject;
  queue: Array<{
    type: "getprocesslist";
  } | {
    type: "getworkerlist";
    processid: string;
  } | {
    type: "restartloop";
  } | {
    type: "close";
  } | {
    type: "inspectworker";
    workerid: string;
    result: (arg: string | null) => void;
  }> = [];
  waitQueue: PromiseWithResolvers<void> | null = null;

  currentprocess = "";

  constructor(screen: HSVMObject) {
    super();
    this.screen = screen;
  }

  init() {
    queueMicrotask(() => void this.run().catch(async e => {
      logError(e as Error);
      await this.screen.GotError((e as Error).message);
    }));
  }

  addToQueue(item: NodeDebuggerApp["queue"][number]) {
    this.queue.push(item);
    if (this.waitQueue) {
      this.waitQueue.resolve();
      this.waitQueue = null;
    }
  }

  async run() {
    runloop:
    while (true) {
      try {
        using link = bridge.connect<DebugMgrClientLink>("ts:debugmgr", { global: true });
        link.on("close", () => {
          console.error(`Debug manager connection closed`);
          this.addToQueue({ type: "restartloop" });
        });
        link.on("message", (packet) => {
          switch (packet.message.type) {
            case DebugMgrClientLinkResponseType.eventProcessListUpdated: {
              this.addToQueue({ type: "getprocesslist" });
            } break;
          }
        });

        await link.activate();

        for (const item of this.queue)
          if ("result" in item)
            item.result(null);

        this.queue = this.queue.filter(item => item.type === "close"); // clear all pending items except "close"
        this.addToQueue({ type: "getprocesslist" });

        await link.doRequest({ type: DebugMgrClientLinkRequestType.subscribeProcessList, enable: true });

        using interval = setInterval(() => {
          if (this.currentprocess && !this.queue.find(i => i.type === "getworkerlist" && i.processid === this.currentprocess)) {
            this.addToQueue({ type: "getworkerlist", processid: this.currentprocess });
          }
        }, 1000);
        void interval;

        while (true) {
          const item = this.queue.shift();
          if (!item) {
            this.waitQueue = Promise.withResolvers<void>();
            await this.waitQueue.promise;
            continue;
          }

          switch (item.type) {
            case "getprocesslist": {
              const res = await link.doRequest({ type: DebugMgrClientLinkRequestType.getProcessList });
              const rows = res.processlist
                .filter(p => p.type === 2)
                .map(p => ({
                  rowkey: p.pid.toString(),
                  ...p,
                  script: p.parameters.script ? toResourcePath(p.parameters.script, { keepUnmatched: true }) : "",
                  arguments: p.parameters.arguments ? (JSON.parse(p.parameters.arguments) as string[]).map(s => JSON.stringify(s)).join(" ") : "",
                  started: p.parameters.started ? new Date(Date.parse(p.parameters.started)) : defaultDateTime,
                }))
                .filter(p => p.script !== "mod::system/js/internal/whmanager/debugmgr.ts"); // filter out the debug manager itself
              await (await this.screen.$get<HSVMObject>("^processlist")).$set("rows", getTypedArray(HareScriptType.RecordArray, rows));
              await this.screen.$invoke("UpdateInterface", []);
            } break;
            case "getworkerlist": {
              const res = await link.doRequest({ type: DebugMgrClientLinkRequestType.getWorkers, processid: item.processid });
              const rows = res.workers.map(row => ({
                rowkey: row.workerid,
                connectid: `${item.processid}.${row.workernr}`,
                ...row,
                processid: item.processid,
              }));
              await (await this.screen.$get<HSVMObject>("^workerlist")).$set("rows", getTypedArray(HareScriptType.RecordArray, rows));
              await this.screen.$invoke("UpdateInterface", []);
            } break;
            case "close": break runloop;
            case "inspectworker": {
              try {
                const res = await link.doRequest({ type: DebugMgrClientLinkRequestType.enableInspector, processid: item.workerid });
                item.result(res.url);
              } catch (e) {
                logError(e as Error);
                item.result(null);
              }
            } break;
          }
        }
      } catch (e) {
        console.error(`Error in debug manager connection:`, e);
        logError(e as Error);
      }
      // wait a bit between reconnections
      await sleep(100);
    }
  }


  gotProcessListSelection(processid: string) {
    if (!this.queue.find(i => i.type === "getworkerlist" && i.processid === processid))
      this.addToQueue({ type: "getworkerlist", processid });
    this.currentprocess = processid;
  }

  gotWorkerListSelection(workerid: string) {
  }

  inspectWorker(workerid: string) {
    const defer = Promise.withResolvers<string | null>();
    this.addToQueue({ type: "inspectworker", workerid, result: defer.resolve });
    return defer.promise ?? "";
  }

  close() {
    this.addToQueue({ type: "close" });
  }
}

export function getNodeDebuggerApp(screen: HSVMObject) {
  return new NodeDebuggerApp(screen);
}
