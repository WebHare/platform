import { ansiCmd, CLIRuntimeError, enumOption } from "@webhare/cli";
import { WebHareBlob } from "@webhare/services";
import { openFileOrFolder, type WHFSObject } from "@webhare/whfs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
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

/** Reads a file or stdin for '-'. useful when parsing command lines */
export async function readArgFile(filename: string): Promise<WebHareBlob> {
  if (filename === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return WebHareBlob.from(Buffer.concat(chunks));
  }

  return WebHareBlob.from(readFileSync(filename));
}

/** Reads and parses a JSON file. Throws a CLIRuntimeError naming the file if it isn't valid JSON
 * @param path - Path of the file to read
 * @returns The parsed contents
 */
export function readJSONFile<T = unknown>(path: string): T {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    //V8's message already includes the position, eg "... in JSON at position 11 (line 3 column 1)"
    throw new CLIRuntimeError(`Invalid JSON in '${path}': ${(e as Error)?.message || "Unknown error"}`);
  }
}

/** Write a line of text, up to the terminal width.
 * @param text Text to write (truncated if needed)
 * @param suffix Either \r (stay on this line) or \n (next line)
 */
export function writeClamped(text: string, suffix: "\r" | "\n") {
  const columns = process.stdout.columns ?? 80;
  const maxChars = Math.max(0, columns - Array.from(suffix).length);
  const clamped = Array.from(text).slice(0, maxChars).join("");
  process.stdout.write(`${clamped}${ansiCmd("eraseline-right")}${suffix}`);
}

/** Ask a question on the terminal. Rejects with a CLIRuntimeError if the user presses Ctrl-C, so cleanup (eg. 'using' disposers) still runs */
export function prompt(question: string): Promise<string> {
  process.stdin.setEncoding("utf8"); //and I guess we can just leave it at that?  can't restore original encoding anyway
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\n");
      reject(new CLIRuntimeError("Aborted", { exitCode: 130 }));
    });
    rl.question(question, answer => { rl.close(); resolve(answer); });
  });
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

/** Edit a file using $VISUAL, $EDITOR or vi. Throws if the editor failed */
export async function runEditor(path: string): Promise<void> {
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";

  //Run through the shell so editors with arguments (eg. 'code --wait') work. The path is passed as a separate argument to avoid quoting issues
  const child = spawn("/bin/sh", ["-c", `${editor} "$1"`, "sh", path], { stdio: "inherit" });

  //Ctrl-C reaches both us and the editor. Leave it to the editor (like git does), and pass on SIGTERM, so we stay alive to clean up after it exits
  const ignoreSignal = () => { };
  const forwardSignal = (signal: NodeJS.Signals) => child.kill(signal);
  process.on("SIGINT", ignoreSignal);
  process.on("SIGTERM", forwardSignal);
  try {
    const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    if (code !== 0)
      throw new CLIRuntimeError(`Editor '${editor}' exited with ${signal ? `signal ${signal}` : `code ${code}`}`);
  } finally {
    process.off("SIGINT", ignoreSignal);
    process.off("SIGTERM", forwardSignal);
  }
}
