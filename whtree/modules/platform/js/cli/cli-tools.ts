import { enumOption } from "@webhare/cli";
import { openFileOrFolder, type WHFSObject } from "@webhare/whfs";
import { kill } from "node:process";
import { createInterface } from "node:readline";

//Shared code for WebHare CLI tools
export const commonFlags = {
  json: { "j,json": { description: "Output in JSON format" } },
  verbose: { "v,verbose": { description: "Show more info" } }
} as const;

export const commonOptions = {
  resources: { resources: { description: "Export resources for fetch (default) or inline as base64", type: enumOption(["fetch", "base64"]), default: "fetch" } }
} as const;

export function prompt(question: string): Promise<string> {
  process.stdin.setEncoding("utf8"); //and I guess we can just leave it at that?  can't restore original encoding anyway
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

export async function promptPassword(question: string): Promise<string> {
  process.stdin.setEncoding("utf8"); //and I guess we can just leave it at that?  can't restore original encoding anyway

  const defer = Promise.withResolvers<string>();
  let password = "";
  const rl = createInterface({ input: process.stdin, output: undefined, terminal: false });
  const onData = (ch: string) => {
    if (ch === "\n" || ch === "\r") {
      process.stdout.write("\n");
      defer.resolve(password);
    } else if (ch === "\u007f" || ch === "\b") {
      password = password.slice(0, -1);
    } else if (ch === "\u0003") { // Ctrl+C
      kill(process.pid, "SIGINT");
    } else {
      password += ch;
    }
  };

  process.stdout.write(question);

  process.stdin.setRawMode(true);
  // process.stdin.resume();
  process.stdin.on("data", onData);

  return defer.promise.finally(() => {
    process.stdin.setRawMode(false);
    process.stdin.removeListener("data", onData);
    rl.close();
  });
}

export async function resolveWHFSPathArgument(path: string, options?: { allowRoot?: boolean }): Promise<WHFSObject> {
  return openFileOrFolder(parseInt(path) > 0 ? parseInt(path) : path, { allowHistoric: true, ...options });
}

export async function resolveWHFSPathArrayArgument(paths: string[], options?: { allowRoot?: boolean }): Promise<WHFSObject[]> {
  return Promise.all(paths.map(path => openFileOrFolder(parseInt(path) > 0 ? parseInt(path) : path, { allowHistoric: true, ...options })));
}
