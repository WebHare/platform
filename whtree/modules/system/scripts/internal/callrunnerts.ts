import WHBridge, { IPCLink } from '@mod-system/js/internal/bridge';
import * as resourcetools from '@mod-system/js/internal/resourcetools';

interface InvokeTask {
  cmd: "invoke";
  id: number;
  func: string;
  args: unknown[];
}

async function runInvoke(task: InvokeTask): Promise<unknown> {
  return await (await resourcetools.loadJSFunction(task.func))(...task.args);
}

function connectIPC(name: string) {
  try {
    const link = new IPCLink;
    link.on("message", async (msg) => {
      const task = msg.message as InvokeTask;
      const msgid = msg.msgid;
      switch (task.cmd) {
        case "invoke": {
          try {
            const value = await runInvoke(task);
            link.send({
              cmd: "response",
              id: task.id,
              value: JSON.stringify(value)
            }, msgid);
          } catch (e: unknown) {
            link.send({
              cmd: "response",
              id: task.id,
              error: {
                type: "exception",
                what: (e as Error).message || "Unknown error",
                trace: WHBridge.getStructuredTrace(e as Error)
              }
            }, msgid);
          }
        }
      }
    });
    link.on("close", () => process.exit()); //FIXME are we sure this is fired? it's not tested yet at least!
    link.connect(process.argv[2], true);
  } catch (e) {
    console.error(`got error: ${e}`);
  }
}

if (process.argv.length <= 2)
  throw new Error(`Missing port name argument`);

connectIPC(process.argv[2]);
