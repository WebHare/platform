import WHBridge from '@mod-system/js/internal/bridge';
interface InvokeTask {
  cmd: "invoke";
  id: number;
  func: string;
  args: unknown[];
}

async function runInvoke(task: InvokeTask): Promise<unknown> {
  let libraryuri = task.func.split("#")[0];
  if (libraryuri.startsWith("mod::"))
    libraryuri = "@mod-" + libraryuri.substring(5);
  const funcname = task.func.split("#")[1] ?? "default";
  const library = await import(libraryuri);
  const func = library[funcname];
  if (typeof func !== "function") {
    throw new Error(`Imported symbol ${task.func} is not a function, but a ${typeof func}`);
  }

  return await func(...task.args);
}

type IPCMessage = {message: InvokeTask; msgid: number};

async function connectIPC(name: string) {
  try {
    const link = await WHBridge.connectIPCPort(process.argv[2], true);
    link.on("message", async (msg) => {
      const task = (msg as IPCMessage).message;
      const msgid = (msg as IPCMessage).msgid;
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
    link.on("close", () => process.exit());
  }
  catch (e) {
    console.error(`got error: ${e}`);
  }
}

if (process.argv.length <= 2)
  throw new Error(`Missing port name argument`);

connectIPC(process.argv[2]);
