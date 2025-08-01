import { existsSync, promises as fs } from "node:fs";
import { backendConfig, openBackendService, toFSPath } from "@webhare/services";
import { activateHMR, registerAsDynamicLoadingLibrary } from "@webhare/services/src/hmr";
import { autoCompleteCLIRunScript, enableAutoCompleteMode, parseCommandLine } from "@webhare/cli/src/run-autocomplete";
import { debugFlags } from "@webhare/env";
import * as http from "node:http";
import { run } from "@webhare/cli";


function parseFSPath(path: string) {
  if (path.startsWith("mod::")) {
    return toFSPath(path);
  }
  if (path.startsWith("~")) {
    return process.env.HOME + path.slice(1);
  }
  return path;
}

async function runAutoComplete(words: string[]): Promise<string[]> {
  const completes = await runRawAutoComplete(words);
  return completes.filter((complete) => complete.startsWith(words[words.length - 1]));
}

async function runRawAutoComplete(words: string[]): Promise<string[]> {
  if (words.length < 3)
    return [];

  const command = words[1];

  if (command === "run") {
    if (words.length === 3) {
      const path = words[2];
      if (path.length < 5 && "mod::\n".startsWith(path)) {
        return ["mod::"];
      }

      const parts = path.split("/");
      if (parts.length === 1) {
        // No completed module name, return all modules
        if (parts[0].startsWith("mod::")) {
          return Object.keys(backendConfig.module).map((mod) => `mod::${mod}/`);
        }
      } else {
        // Return dirs and .whscr, .ts files
        const baseResourceDir = path.slice(0, path.lastIndexOf("/") + 1);
        const baseFsDir = parseFSPath(baseResourceDir);
        const files = (await fs.readdir(baseFsDir, { withFileTypes: true })).filter(v => v.isDirectory() || v.name.endsWith(".ts") || v.name.endsWith(".whscr"));
        return files.map((f) => `${baseResourceDir}${f.name}${f.isDirectory() ? "/" : "\n"}`);
      }
    } else {
      return autoCompleteCLIRunScript(parseFSPath(words[2]), words.slice(3), { debug: debugFlags.autocomplete });
    }
  } else {
    if (command.includes(":")) {
      const parts = command.split(":");
      const moduleData = backendConfig.module[parts[0]];
      if (!moduleData)
        return [];
      const fsPath = `${moduleData.root}/scripts/whcommands/${parts[1]}.ts`;
      if (!existsSync(fsPath))
        return [];
      return autoCompleteCLIRunScript(fsPath, words.slice(2), { debug: debugFlags.autocomplete });
    } else {
      let fsPath = `${backendConfig.module.platform.root}/scripts/whcommands/${command}.ts`;
      if (existsSync(fsPath))
        return autoCompleteCLIRunScript(fsPath, words.slice(2), { debug: debugFlags.autocomplete });
      fsPath = `${backendConfig.module.system.root}/scripts/whcommands/${command}.ts`;
      if (existsSync(fsPath)) {
        return autoCompleteCLIRunScript(fsPath, words.slice(2), { debug: debugFlags.autocomplete });
      }
      return [];
    }
  }
  return [];
}

function swallowCBPromise<T extends unknown[]>(p: (...arg: T) => Promise<unknown>) { return (...args: T) => void p(...args); }

async function runServerMode() {
  let activeConnections = 0;
  let gotTimeout = false;

  // Exit after a set timeout if there are no active connections
  setTimeout(() => {
    gotTimeout = true;
    if (activeConnections === 0)
      process.exit(0);
  }, 5 * 60 * 1000);

  /* Open a unix domain socket and listen for connections. Can't send raw data over domain sockets, because
     MacOS doesn't have a utility that does sending and receiving. curl can send and receive over domain sockets,
     however. So HTTP it is.
  */
  const server = http.createServer((req, res) => {
    ++activeConnections;
    res.statusCode = 200;

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', swallowCBPromise(async () => {
      if (req.url === "/autocomplete") {
        const words = parseCommandLine(body);
        const completes = await runAutoComplete(words);
        const txt = completes.map(opt => opt.replace(" ", "\\ ").replace(/\n$/m, " ")).map((opt) => opt + "\n").join("");
        res.write(txt);
        res.end();
      } else {
        res.statusCode = 400;
        res.end(`Unknown URL ${req.url}`);
      }
      // Exit if the last connection is done and we got a timeout
      if (!--activeConnections && gotTimeout)
        process.exit(0);
    }));

    res.setHeader('Content-Type', 'text/plain');
  });

  const socketPath = backendConfig.dataRoot + "/.cli-autocomplete.sock";
  try {
    // unlink the file if it exists
    await fs.unlink(socketPath);
  } catch (e) {
  }

  server.listen(backendConfig.dataRoot + "/.cli-autocomplete.sock");
}

run({
  flags: {
    "server": { description: "Start a autocomplete server" },
    "try-start-service": { description: "Try to start the service" },
  },
  async main({ opts }) {
    enableAutoCompleteMode({ registerAsDynamicLoader: (module) => registerAsDynamicLoadingLibrary(module) });
    activateHMR();

    using smservice = opts.tryStartService ? await openBackendService("platform:servicemanager", [], { timeout: 5000, notOnDemand: true }) : null;
    const serviceStartPromise = smservice ? smservice.startService("platform:autocompleteservice") : null;

    if (opts.server) {
      void runServerMode();
    } else {
      if (process.env.COMP_SLICED_LINE === undefined)
        throw new Error(`Missing COMP_SLICED_LINE`);

      /* Use only the line until the cursor position. Add a char to make sure we don't ignore the last whitespace (and
         get an empty argument if the cursor is at the end of the line, with whitespace after the last argument.
      */
      const params = parseCommandLine(process.env.COMP_SLICED_LINE);


      const completes = await runAutoComplete(params);
      for (const complete of completes) {
        console.log(complete.replace(" ", "\\ ").replace(/\n$/m, " "));
      }
    }

    await serviceStartPromise;
  }
});
