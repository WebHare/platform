/** This script is invoked by mod::system/lib/internal/tasks/callasync.whlib to implement native ImportJS */

import bridge, { type IPCLinkType, type IPCMessagePacket } from "@mod-system/js/internal/whmanager/bridge";
import { importJSFunction } from "@webhare/services";
import { activateHMR } from "@webhare/services/src/hmr";

interface InvokeTask {
  cmd: "invoke";
  func: string;
  args: unknown[];
  options?: { wrapobjects: boolean };
}

interface InvokeResponse {
  cmd: "response";
  value: unknown;
}

type CallRunnerLinkType = IPCLinkType<InvokeResponse, InvokeTask>;

export type InvokeFunction = (...args: unknown[]) => unknown;

async function runInvoke(task: InvokeTask): Promise<unknown> {
  return await (await importJSFunction<InvokeFunction>(task.func))(...task.args);
}

function connectIPC(name: string) {
  try {
    const link = bridge.connect<CallRunnerLinkType>(name, { global: true });
    const pending = new Set<bigint>();

    async function handleMessage(msg: IPCMessagePacket<InvokeTask>) {
      switch (msg.message.cmd) {
        case "invoke": {
          try {
            pending.add(msg.msgid);
            let value = await runInvoke(msg.message);
            if (value === undefined)
              value = false;
            link.send({
              cmd: "response",
              value: msg.message.options?.wrapobjects ? JSON.stringify(value) : value
            }, msg.msgid);
          } catch (e: unknown) {
            link.sendException(e as Error, msg.msgid);
          } finally {
            pending.delete(msg.msgid);
          }
        }
      }
    }

    link.on("message", (msg) => void handleMessage(msg));
    link.on("close", () => process.exit()); //FIXME are we sure this is fired? it's not tested yet at least!
    process.on("unhandledRejection", (reason: unknown) => {
      if (pending.size > 0) { //try to reject all pending messages, at least that should give the caller a somewhat usable trace
        for (const msgid of pending)
          link.sendException(reason as Error, msgid);
      } else {
        //this will probably only end up in a log somewhere
        link.sendException(reason as Error, 0n);
      }
    });
    void link.activate();
  } catch (e) {
    console.error(`got error: ${e}`);
  }
}

if (process.argv.length <= 2)
  throw new Error(`Missing port name argument`);

connectIPC(process.argv[2]);
activateHMR();
