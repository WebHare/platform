import bridge, { IPCLinkType } from "@mod-system/js/internal/whmanager/bridge";
import * as resourcetools from '@mod-system/js/internal/resourcetools';

interface InvokeTask {
  cmd: "invoke";
  func: string;
  args: unknown[];
}

interface InvokeResponse {
  cmd: "response";
  value: string;
}

type CallRunnerLinkType = IPCLinkType<InvokeResponse, InvokeTask>;

async function runInvoke(task: InvokeTask): Promise<unknown> {
  return await (await resourcetools.loadJSFunction(task.func))(...task.args);
}

function connectIPC(name: string) {
  try {
    const link = bridge.connect<CallRunnerLinkType>(name, { global: true });
    link.on("message", async (msg) => {
      switch (msg.message.cmd) {
        case "invoke": {
          try {
            let value = await runInvoke(msg.message);
            if (value === undefined)
              value = false;
            link.send({
              cmd: "response",
              value: JSON.stringify(value)
            }, msg.msgid);
          } catch (e: unknown) {
            link.sendException(e as Error, msg.msgid);
          }
        }
      }
    });
    link.on("close", () => process.exit()); //FIXME are we sure this is fired? it's not tested yet at least!
    link.activate();
  } catch (e) {
    console.error(`got error: ${e}`);
  }
}

if (process.argv.length <= 2)
  throw new Error(`Missing port name argument`);

connectIPC(process.argv[2]);
